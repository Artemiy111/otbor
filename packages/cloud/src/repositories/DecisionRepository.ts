import type { DecisionReason, DecisionRecord } from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { decision } from "../db/tables.ts"

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
  priority: row.priority,
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
  select d.*, vacancy.title as vacancy_title
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
  const order = (() => {
    switch (sort) {
      case "priority":
        return sql`d.priority desc, d.fit desc, d.created_at desc, d.id desc`
      case "fit":
        return sql`d.fit desc, d.priority desc, d.created_at desc, d.id desc`
      case "newest":
        return sql`vacancy.published_at desc nulls last, d.priority desc, d.id desc`
      case "salary":
        return sql`coalesce(vacancy.salary_to, vacancy.salary_from) desc nulls last, d.priority desc, d.id desc`
      case "random":
        return sql`random()`
      default:
        return sql`d.created_at desc, d.id desc`
    }
  })()

  return tx
    .execute(sql`
      select d.*, vacancy.title as vacancy_title
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
