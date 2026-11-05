import type { DecisionReason, DecisionRecord } from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { decision } from "../db/tables.ts"
import { DEFAULT_APPLY_SETTINGS } from "@otbor/domain"

/**
 * Live priority of the decision row aliased `d`, joined to `vacancy`:
 * `fit x freshness` evaluated NOW, so age alone never leaves a stored
 * priority stale. SQL twin of `computeFreshness` in `@otbor/domain`
 * (`0.5 ^ (age / halfLife)` clamped to 0.05..1, 0.5 without `published_at`).
 * The half-life is the decision's own apply filter: the (account, resume) row,
 * else the account-level row, else the domain default. Only `apply` decisions
 * have a priority; everything else keeps the stored 0.
 */
export const livePriorityExpr: SQL = sql`(case when d.verdict <> 'apply' then d.priority else round((d.fit * (
  case when vacancy.published_at is null then 0.5 else greatest(0.05, least(1, power(0.5,
    greatest(0, extract(epoch from (now() - vacancy.published_at)) / 3600.0)
    / greatest(1, coalesce(
      (select f.fresh_half_life_hours from apply_filter f
        where f.user_id = d.user_id and f.hh_account_id = d.hh_account_id and f.resume_id = d.resume_id),
      (select f.fresh_half_life_hours from apply_filter f
        where f.user_id = d.user_id and f.hh_account_id = d.hh_account_id and f.resume_id is null),
      ${DEFAULT_APPLY_SETTINGS.freshHalfLifeHours}::int
    ))::float8
  ))) end
))::numeric, 2)::float8 end)`

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export interface DecisionRow {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string | null
  readonly resume_id: string | null
  readonly vacancy_id: string
  readonly vacancy_title: string | null
  readonly verdict: string
  readonly fit: number
  readonly priority: number
  /** Priority evaluated now (see `livePriorityExpr`); absent on raw rows. */
  readonly live_priority?: number | string | null
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policy_version: number
  readonly created_at: Date
}

export const toRecord = (row: DecisionRow): DecisionRecord => ({
  id: row.id as DecisionRecord["id"],
  userId: row.user_id as DecisionRecord["userId"],
  hhAccountId: row.hh_account_id as DecisionRecord["hhAccountId"],
  resumeId: row.resume_id as DecisionRecord["resumeId"],
  vacancyId: row.vacancy_id as DecisionRecord["vacancyId"],
  vacancyTitle: row.vacancy_title ?? undefined,
  verdict: row.verdict as DecisionRecord["verdict"],
  fit: row.fit,
  priority: row.live_priority === undefined || row.live_priority === null
    ? row.priority
    : Number(row.live_priority),
  reasons: row.reasons,
  policyVersion: row.policy_version,
  createdAt: row.created_at.toISOString()
})

export interface PersistDecisionInput {
  readonly userId: string
  readonly hhAccountId: string | null
  readonly resumeId: string | null
  readonly vacancyId: string
  readonly verdict: "apply" | "draft" | "skip"
  readonly fit: number
  readonly priority: number
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policyVersion: number
  readonly inputHash: string
  /** `vacancy.content_hash` the decision was made for (drives staleness). */
  readonly vacancyContentHash: string
  /**
   * Re-stamp an existing row with the same inputs. A decision made with a stored
   * analysis sets this, so it stays newer than the analysis row (staleness
   * compares the two) even when the analysis changed nothing the decision reads.
   */
  readonly restamp?: boolean
}

const selectDecision = sql`
  select d.*, vacancy.title as vacancy_title, ${livePriorityExpr} as live_priority
  from decision d
  join vacancy on vacancy.id = d.vacancy_id
`

export const persist = (
  tx: Executor,
  input: PersistDecisionInput
): RepoEffect<DecisionRecord> =>
  Effect.gen(function*() {
    yield* tx
      .insert(decision)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        resumeId: input.resumeId,
        vacancyId: input.vacancyId,
        verdict: input.verdict,
        fit: input.fit,
        priority: input.priority,
        reasons: input.reasons,
        policyVersion: input.policyVersion,
        inputHash: input.inputHash,
        vacancyContentHash: input.vacancyContentHash
      })
      // The same inputs give the same decision, so no second row. Two repairs
      // keep "latest decision" truthful: fill the content hash on rows that
      // predate it, and re-stamp a row that a newer decision has overtaken
      // (content flipped A -> B -> A), so the confirmed one is the latest again.
      .onConflictDoUpdate({
        target: [decision.userId, decision.vacancyId, decision.policyVersion, decision.inputHash],
        set: {
          vacancyContentHash: sql`excluded.vacancy_content_hash`,
          createdAt: sql`now()`
        },
        setWhere: sql`${input.restamp === true ? sql`true` : sql`false`}
          or ${decision.vacancyContentHash} is null or exists (
          select 1 from decision newer
          where newer.user_id = ${decision.userId}
            and newer.vacancy_id = ${decision.vacancyId}
            and newer.created_at > ${decision.createdAt}
        )`
      })

    const [row] = (
      yield* tx.execute(sql`
        ${selectDecision}
        where d.user_id = ${input.userId}
          and d.vacancy_id = ${input.vacancyId}
          and d.policy_version = ${input.policyVersion}
          and d.input_hash = ${input.inputHash}
        limit 1
      `)
    ).rows

    return toRecord(row as unknown as DecisionRow)
  })

export const findById = (tx: Executor, id: string): RepoEffect<DecisionRecord | null> =>
  tx
    .execute(sql`${selectDecision} where d.id = ${id} limit 1`)
    .pipe(Effect.map((result) => {
      const row = result.rows[0] as unknown as DecisionRow | undefined
      return row === undefined ? null : toRecord(row)
    }))

export interface DecisionListOptions {
  readonly verdict?: string
  readonly limit?: number
  readonly offset?: number
  readonly orderBy?: "priority" | "created"
  readonly minFit?: number
  readonly maxFit?: number
  readonly sort?: "priority" | "fit" | "newest" | "salary" | "random"
  readonly hhAccountId?: string
  /** Newest decision per vacancy and account only. */
  readonly latestPerVacancy?: boolean
  /** A preset's vacancy filter, already compiled over the `vacancy` table. */
  readonly vacancyFilter?: SQL
}

/**
 * The ORDER BY of a decision list for one sort key. Shared with the auto-apply
 * candidate query so "newest" and "salary" mean the same everywhere.
 */
export const decisionOrder = (
  sort: DecisionListOptions["sort"] | undefined,
  direction: "desc" | "asc" = "desc"
): SQL => {
  // Every term flips with the direction, tiebreakers included; `nulls last`
  // stays last in both directions.
  const dir = direction === "asc" ? sql.raw("asc") : sql.raw("desc")
  switch (sort) {
    case "priority":
      return sql`${livePriorityExpr} ${dir}, d.fit ${dir}, d.created_at ${dir}, d.id ${dir}`
    case "fit":
      return sql`d.fit ${dir}, ${livePriorityExpr} ${dir}, d.created_at ${dir}, d.id ${dir}`
    case "newest":
      return sql`vacancy.published_at ${dir} nulls last, ${livePriorityExpr} ${dir}, d.id ${dir}`
    case "salary":
      return sql`coalesce(vacancy.salary_to, vacancy.salary_from) ${dir} nulls last, ${livePriorityExpr} ${dir}, d.id ${dir}`
    case "random":
      return sql`random()`
    default:
      return sql`d.created_at ${dir}, d.id ${dir}`
  }
}

export const list = (
  tx: Executor,
  userId: string,
  options: DecisionListOptions = {}
): RepoEffect<ReadonlyArray<DecisionRecord>> => {
  // `distinct on` keeps the newest row of each vacancy+account; filters apply
  // to that survivor, so an old `apply` never shows through a newer `skip`.
  const source = options.latestPerVacancy === true
    ? sql`(
        select distinct on (x.vacancy_id, x.hh_account_id) x.*
        from decision x
        where x.user_id = ${userId}
        order by x.vacancy_id, x.hh_account_id, x.created_at desc, x.id desc
      ) d`
    : sql`decision d`

  const sort = options.sort ?? (options.orderBy === "priority" ? "priority" : undefined)
  const order = decisionOrder(sort)

  return tx
    .execute(sql`
      select d.*, vacancy.title as vacancy_title, ${livePriorityExpr} as live_priority
      from ${source}
      join vacancy on vacancy.id = d.vacancy_id
      where d.user_id = ${userId}
        ${options.verdict === undefined || options.verdict === ""
          ? sql``
          : sql`and d.verdict = ${options.verdict}`}
        ${options.minFit === undefined ? sql`` : sql`and d.fit >= ${options.minFit}`}
        ${options.maxFit === undefined ? sql`` : sql`and d.fit <= ${options.maxFit}`}
        ${options.hhAccountId === undefined
          ? sql``
          : sql`and d.hh_account_id = ${options.hhAccountId}`}
        ${options.vacancyFilter === undefined ? sql`` : sql`and ${options.vacancyFilter}`}
      order by ${order}
      limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
      offset ${Math.max(options.offset ?? 0, 0)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<DecisionRow>).map(toRecord)
      )
    )
}

/* -------------------------------------------------------------------------- */
/* Staleness                                                                  */
/* -------------------------------------------------------------------------- */

export interface StaleVacanciesOptions {
  readonly userId: string
  readonly policyVersion: number
  /** Include vacancies whose decision is current. */
  readonly force?: boolean
  readonly vacancyIds?: ReadonlyArray<string>
  /** Also stale: the vacancy's analysis (this prompt version) is newer than its decision. */
  readonly analysisPromptVersion?: string
}

/**
 * The SQL twin of `isDecisionStale` in `@otbor/domain`: no decision, other
 * content, or other policy version. Compared
 * against the newest decision of the user for the vacancy. Also stale: the
 * decision predates an edit of any of the user's apply filters.
 */
const staleFrom = (options: StaleVacanciesOptions) => sql`
  from vacancy
  left join lateral (
    select x.vacancy_content_hash, x.policy_version, x.created_at
    from decision x
    where x.user_id = ${options.userId} and x.vacancy_id = vacancy.id
    order by x.created_at desc, x.id desc
    limit 1
  ) d on true
  where ${options.vacancyIds === undefined
      ? sql`true`
      : options.vacancyIds.length === 0
        ? sql`false`
        : sql`vacancy.id in (${sql.join(options.vacancyIds.map((id) => sql`${id}`), sql`, `)})`}
    and (
      ${options.force === true ? sql`true` : sql`false`}
      or d.policy_version is null
      or d.vacancy_content_hash is distinct from vacancy.content_hash
      or d.policy_version <> ${options.policyVersion}
      -- Editing an apply filter re-decides everything decided before the edit.
      or exists (
        select 1 from apply_filter f
        where f.user_id = ${options.userId} and f.rules_changed_at > d.created_at
      )
      ${options.analysisPromptVersion === undefined
        ? sql``
        : sql`or exists (
            select 1 from vacancy_analysis a
            where a.vacancy_id = vacancy.id
              and a.prompt_version = ${options.analysisPromptVersion}
              and a.updated_at > d.created_at
          )`}
    )
`

/** Vacancy ids to evaluate: live and fresh first, so a bounded batch helps most. */
export const staleVacancyIds = (
  tx: Executor,
  options: StaleVacanciesOptions & { readonly limit: number }
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select vacancy.id::text as id
      ${staleFrom(options)}
      order by vacancy.archived asc, vacancy.published_at desc nulls last, vacancy.id
      limit ${options.limit}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ id: string }>).map((row) => row.id)
      )
    )

export const countStaleVacancies = (
  tx: Executor,
  options: StaleVacanciesOptions
): RepoEffect<number> =>
  tx
    .execute(sql`select count(*)::int as count ${staleFrom(options)}`)
    .pipe(
      Effect.map((result) =>
        Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
      )
    )


/* -------------------------------------------------------------------------- */
/* Auto-apply candidates                                                      */
/* -------------------------------------------------------------------------- */

export interface AutoApplyCandidateOptions {
  readonly hhAccountId: string
  /** The pair row's resume; null selects for the account-level row. */
  readonly resumeId: string | null
  /** Account-level row only: resumes that have their own row (the pair row wins there). */
  readonly excludeResumeIds: ReadonlyArray<string>
  readonly minPriority: number
  readonly sort: "priority" | "fit" | "newest" | "salary"
  /** `asc` reverses every term of the ordering (nulls stay last). Default `desc`. */
  readonly sortDirection?: "desc" | "asc"
  readonly limit: number
  readonly policyVersion: number
  readonly analysisPromptVersion: string
}

/**
 * Current `apply` decisions of one hh account that nothing has been applied to
 * yet. "Current" is the SQL twin of `staleFrom`: the newest decision of its
 * (vacancy, account, resume), made for the vacancy's present content and the
 * present policy, not older than an edit of any apply filter or the vacancy's
 * analysis. A live vacancy only. An application of the account to the vacancy
 * (any state, any origin) removes the decision; an application with an unknown
 * resume counts for every resume, like `ApplicationRepository.existsForVacancy`.
 */
export const autoApplyCandidates = (
  tx: Executor,
  userId: string,
  options: AutoApplyCandidateOptions
): RepoEffect<ReadonlyArray<DecisionRecord>> =>
  tx
    .execute(sql`
      select d.*, vacancy.title as vacancy_title, ${livePriorityExpr} as live_priority
      from (
        select distinct on (x.vacancy_id, x.resume_id) x.*
        from decision x
        where x.user_id = ${userId} and x.hh_account_id = ${options.hhAccountId}
        order by x.vacancy_id, x.resume_id, x.created_at desc, x.id desc
      ) d
      join vacancy on vacancy.id = d.vacancy_id
      where d.verdict = 'apply'
        and ${livePriorityExpr} >= ${options.minPriority}
        and vacancy.archived = false
        and d.policy_version = ${options.policyVersion}
        and d.vacancy_content_hash is not distinct from vacancy.content_hash
        and not exists (
          select 1 from apply_filter f
          where f.user_id = ${userId} and f.rules_changed_at > d.created_at
        )
        and not exists (
          select 1 from vacancy_analysis a
          where a.vacancy_id = vacancy.id
            and a.prompt_version = ${options.analysisPromptVersion}
            and a.updated_at > d.created_at
        )
        and not exists (
          select 1 from decision newer
          where newer.user_id = d.user_id
            and newer.vacancy_id = d.vacancy_id
            and newer.hh_account_id = d.hh_account_id
            and newer.created_at > d.created_at
        )
        ${options.resumeId === null
          ? options.excludeResumeIds.length === 0
            ? sql``
            : sql`and (d.resume_id is null or d.resume_id not in (${sql.join(
                options.excludeResumeIds.map((id) => sql`${id}`),
                sql`, `
              )}))`
          : sql`and d.resume_id = ${options.resumeId}`}
        and not exists (
          select 1 from application a
          where a.hh_account_id = d.hh_account_id
            and a.vacancy_id = d.vacancy_id
            and (d.resume_id is null or a.resume_id = d.resume_id or a.resume_id is null)
        )
      order by ${decisionOrder(options.sort, options.sortDirection)}
      limit ${Math.max(0, Math.trunc(options.limit))}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<DecisionRow>).map(toRecord)
      )
    )
