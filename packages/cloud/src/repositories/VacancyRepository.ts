import { HhVacancySignals as HhVacancySignalsSchema } from "@otbor/contract"
import { ANALYSIS_PROMPT_VERSION } from "@otbor/domain"
import type {
  BlacklistScope,
  HhAccountId,
  HhVacancySignals,
  EmployerDraft,
  HydrationTarget,
  SalaryDraft,
  VacancyDraft,
  VacancySortKey,
  VacancySummary
} from "@otbor/contract"
import { eq, sql, type SQL } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { employer, vacancy, vacancyResponseSample, vacancySkill, vacancySnapshot } from "../db/tables.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"
import { livePriorityExpr } from "./DecisionRepository.ts"
import * as HydrationAttemptRepository from "./HydrationAttemptRepository.ts"

export interface VacancyRow {
  readonly id: string
  readonly source: string
  readonly externalId: string
  readonly canonicalUrl: string
  readonly title: string
  readonly employerId: string | null
  readonly employerExternalId: string | null
  readonly employerName: string | null
  readonly employerRating: number | null
  readonly employerLogoUrl?: string | null
  readonly areaName: string | null
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly seniority: string
  readonly experienceCode: string | null
  readonly employmentForm: string | null
  readonly publishedAt: Date | null
  readonly archived: boolean
  readonly createdAt: Date
  readonly lastSeenAt: Date
  readonly contentHash: string
  readonly descriptionText: string | null
  readonly descriptionHtml: string | null
  readonly workFormats: ReadonlyArray<string>
  readonly skills: ReadonlyArray<string>
  readonly responsesTotal?: number | null
  readonly responsesVacancy?: number | null
  readonly blacklistLayers?: ReadonlyArray<BlacklistScope> | null
  readonly analysed?: boolean | null
  readonly analysisRole?: string | null
  readonly analysisYearsMin?: number | null
  readonly letterRequired?: boolean | null
  readonly hasTest?: boolean | null
  readonly testRequired?: boolean | null
  readonly responded?: ReadonlyArray<{ readonly accountId: string; readonly resumeIds: ReadonlyArray<string | null> }> | null
  /** Колонки решения и отклика области запроса: есть только в `list`, там null значит "нет". */
  readonly decVerdict?: string | null
  readonly decFit?: number | null
  readonly decPriority?: number | string | null
  readonly decResumeId?: string | null
  readonly decReason?: { readonly code: string; readonly detail?: string | null } | null
  readonly appId?: string | null
  readonly appState?: string | null
  readonly appBlockedReason?: string | null
  readonly appHhStatus?: string | null
  readonly appAutoRun?: string | null
}

const toSnippet = (text: string | null): string | null => {
  const flat = text?.replace(/\s+/g, " ").trim() ?? ""
  return flat === "" ? null : flat.length > 280 ? `${flat.slice(0, 280).trimEnd()}…` : flat
}

export const toSummary = (row: VacancyRow): VacancySummary => {
  const blacklistLayers = [...(row.blacklistLayers ?? [])]
  return {
    analysed: row.analysed === true,
    id: row.id as VacancySummary["id"],
    source: row.source,
    externalId: row.externalId,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    employerId: row.employerId as VacancySummary["employerId"],
    employerName: row.employerName,
    employerRating: row.employerRating,
    employerLogoUrl: row.employerLogoUrl ?? null,
    areaName: row.areaName,
    salaryFrom: row.salaryFrom,
    salaryTo: row.salaryTo,
    salaryCurrency: row.salaryCurrency,
    seniority: row.seniority as VacancySummary["seniority"],
    experienceCode: row.experienceCode,
    employmentForm: row.employmentForm,
    workFormats: row.workFormats,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    blacklisted: blacklistLayers.length > 0,
    blacklistLayers,
    responsesTotal: row.responsesTotal ?? null,
    responsesVacancy: row.responsesVacancy ?? null,
    analysisRole: row.analysisRole ?? null,
    analysisYearsMin: row.analysisYearsMin == null ? null : Number(row.analysisYearsMin),
    letterRequired: row.letterRequired ?? null,
    hasTest: row.hasTest ?? null,
    testRequired: row.testRequired ?? null,
    snippet: toSnippet(row.descriptionText),
    responded: [...(row.responded ?? [])],
    // Решение и отклик есть только у строк списка; у остальных ключей нет совсем.
    ...("decVerdict" in row
      ? {
          decision:
            row.decVerdict == null
              ? null
              : {
                  verdict: row.decVerdict as "apply" | "draft" | "skip",
                  fit: Number(row.decFit ?? 0),
                  priority: Number(row.decPriority ?? 0),
                  topReason:
                    row.decReason == null
                      ? null
                      : {
                          code: row.decReason.code as never,
                          ...(row.decReason.detail == null ? {} : { detail: row.decReason.detail })
                        },
                  resumeId: (row.decResumeId ?? null) as never
                },
          application:
            row.appId == null
              ? null
              : {
                  id: row.appId as never,
                  state: row.appState as never,
                  blockedReason: (row.appBlockedReason ?? null) as never,
                  hhStatus: row.appHhStatus ?? null,
                  autoRun: (row.appAutoRun ?? null) as never
                }
        }
      : {})
  }
}

/**
 * A search card is a stub: no description HTML and at most a short snippet.
 * The same rule decides `hydration_status` at ingest and which rows the
 * hydration command picks, so the two cannot drift apart.
 */
export const HYDRATION_MIN_DESCRIPTION = 400

export const needsHydration = (
  input: {
    readonly descriptionHtml?: string | null
    readonly descriptionText?: string | null
  },
  minDescriptionLength: number = HYDRATION_MIN_DESCRIPTION
): boolean =>
  input.descriptionHtml === null ||
  input.descriptionHtml === undefined ||
  (input.descriptionText?.trim().length ?? 0) < Math.max(0, minDescriptionLength)

/** The description columns that a later search-card upsert must not erase. */
export interface StoredDescription {
  readonly descriptionText: string | null
  readonly descriptionHtml: string | null
  readonly skills: ReadonlyArray<string>
}

/**
 * A search card that arrives after hydration carries no description. Keep the
 * stored full text and skills instead of replacing them with a stub, so a
 * repeat crawl cannot undo `otbor hydrate`.
 */
export const mergeStubDescription = (
  draft: VacancyDraft,
  existing: StoredDescription | null
): VacancyDraft => {
  if (existing === null || !needsHydration(draft) || needsHydration(existing)) return draft

  return {
    ...draft,
    descriptionText: existing.descriptionText,
    descriptionHtml: existing.descriptionHtml,
    skills: [...existing.skills]
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export const upsertEmployer = (tx: Executor, source: string, draft: EmployerDraft) =>
  tx
    .insert(employer)
    .values({
      source,
      externalId: draft.externalId,
      name: draft.name,
      rating: draft.rating ?? null,
      reviewsCount: draft.reviewsCount ?? null,
      recommendationsPercent: draft.recommendationsPercent ?? null,
      siteUrl: draft.siteUrl ?? null,
      logoUrl: draft.logoUrl ?? null,
      industries: draft.industries ?? []
    })
    .onConflictDoUpdate({
      target: [employer.source, employer.externalId],
      set: {
        name: sql`excluded.name`,
        rating: sql`excluded.rating`,
        reviewsCount: sql`excluded.reviews_count`,
        recommendationsPercent: sql`excluded.recommendations_percent`,
        siteUrl: sql`excluded.site_url`,
        logoUrl: sql`excluded.logo_url`,
        industries: sql`excluded.industries`
      }
    })
    .returning({ id: employer.id })

const salaryParts = (salary: SalaryDraft | null | undefined) => ({
  salaryFrom: salary?.from ?? null,
  salaryTo: salary?.to ?? null,
  salaryCurrency: salary?.currency ?? null,
  salaryGross: salary?.gross ?? null,
  salaryNegotiable: salary?.negotiable ?? false
})

export interface UpsertVacancyInput {
  readonly draft: VacancyDraft
  readonly employerId: string | null
  readonly contentHash: string
  readonly source: string
}

export const upsertVacancy = (tx: Executor, input: UpsertVacancyInput) => {
  const { draft } = input
  const values = {
    source: input.source,
    externalId: draft.externalId,
    canonicalUrl: draft.canonicalUrl,
    url: draft.url ?? null,
    title: draft.title,
    employerId: input.employerId,
    areaId: draft.areaId ?? null,
    areaName: draft.areaName ?? null,
    ...salaryParts(draft.salary),
    experienceCode: draft.experienceCode ?? null,
    employmentForm: draft.employmentForm ?? null,
    workFormats: draft.workFormats ?? [],
    seniority: draft.seniority ?? "unknown",
    publishedAt: draft.publishedAt === null || draft.publishedAt === undefined
      ? null
      : new Date(draft.publishedAt),
    archived: draft.archived ?? false,
    descriptionText: draft.descriptionText ?? null,
    descriptionHtml: draft.descriptionHtml ?? null,
    hydrationStatus: needsHydration(draft) ? "stub" : "full",
    contentHash: input.contentHash,
    responsesTotal: draft.responsesTotal ?? null,
    responsesVacancy: draft.responsesVacancy ?? null,
    signals: draft.hhSignals === undefined ? {} : { hh: draft.hhSignals }
  }

  return tx
    .insert(vacancy)
    .values(values)
    .onConflictDoUpdate({
      target: [vacancy.source, vacancy.externalId],
      set: {
        canonicalUrl: sql`excluded.canonical_url`,
        url: sql`excluded.url`,
        title: sql`excluded.title`,
        employerId: sql`excluded.employer_id`,
        areaId: sql`excluded.area_id`,
        areaName: sql`excluded.area_name`,
        salaryFrom: sql`excluded.salary_from`,
        salaryTo: sql`excluded.salary_to`,
        salaryCurrency: sql`excluded.salary_currency`,
        salaryGross: sql`excluded.salary_gross`,
        salaryNegotiable: sql`excluded.salary_negotiable`,
        experienceCode: sql`excluded.experience_code`,
        employmentForm: sql`excluded.employment_form`,
        workFormats: sql`excluded.work_formats`,
        seniority: sql`excluded.seniority`,
        publishedAt: sql`excluded.published_at`,
        archived: sql`excluded.archived`,
        descriptionText: sql`excluded.description_text`,
        descriptionHtml: sql`excluded.description_html`,
        hydrationStatus: sql`excluded.hydration_status`,
        contentHash: sql`excluded.content_hash`,
        // Only the vacancy page carries the counts; a search card (null) must not erase them.
        responsesTotal: sql`coalesce(excluded.responses_total, ${vacancy.responsesTotal})`,
        responsesVacancy: sql`coalesce(excluded.responses_vacancy, ${vacancy.responsesVacancy})`,
        // jsonb merge: a stub draft ({}) leaves stored keys, `hh` replaces only `hh`.
        signals: sql`${vacancy.signals} || excluded.signals`,
        lastSeenAt: sql`now()`
      }
    })
    .returning({ id: vacancy.id, inserted: sql<boolean>`xmax = 0` })
}

export const replaceSkills = (
  tx: Executor,
  vacancyId: string,
  skills: ReadonlyArray<string>,
  source = "hh"
) =>
  Effect.gen(function*() {
    yield* tx.delete(vacancySkill).where(sql`${vacancySkill.vacancyId} = ${vacancyId}`)
    if (skills.length === 0) return
    yield* tx.insert(vacancySkill).values(
      skills.map((term, index) => ({
        vacancyId,
        term,
        normalizedTerm: term.trim().toLowerCase().replace(/ё/g, "е"),
        source,
        position: index
      }))
    )
  })

export const insertSnapshot = (
  tx: Executor,
  input: {
    readonly vacancyId: string
    readonly contentHash: string
    readonly raw: unknown
    readonly descriptionText: string | null
    readonly adapter?: string
  }
) =>
  tx
    .insert(vacancySnapshot)
    .values({
      vacancyId: input.vacancyId,
      contentHash: input.contentHash,
      raw: input.raw ?? {},
      descriptionText: input.descriptionText,
      adapter: input.adapter ?? "hh"
    })
    .onConflictDoNothing()

/** Merge `signals.hh` into an existing row without touching other keys. */
export const mergeHhSignals = (tx: Executor, id: string, signals: HhVacancySignals) =>
  tx
    .update(vacancy)
    .set({ signals: sql`${vacancy.signals} || ${JSON.stringify({ hh: signals })}::jsonb` })
    .where(sql`${vacancy.id} = ${id}`)
    .pipe(Effect.asVoid)

const decodeHhSignals = Schema.decodeUnknownOption(HhVacancySignalsSchema)

/** Stored `signals.hh`, decoded defensively; missing or invalid gives null. */
export const hhSignalsOf = (tx: Executor, vacancyId: string) =>
  tx
    .select({ hh: sql<unknown>`${vacancy.signals} -> 'hh'` })
    .from(vacancy)
    .where(sql`${vacancy.id} = ${vacancyId}`)
    .limit(1)
    .pipe(
      Effect.map((rows): HhVacancySignals | null => {
        const raw = rows[0]?.hh
        if (raw === null || raw === undefined) return null
        const decoded = decodeHhSignals(raw)
        return decoded._tag === "Some" ? decoded.value : null
      })
    )

/**
 * The text did not change, but the page carried fresh response counts. Store
 * them without rewriting the row; a null side keeps what is stored.
 */
export const mergeResponseCounts = (
  tx: Executor,
  id: string,
  counts: { readonly total: number | null; readonly vacancy: number | null }
) =>
  tx
    .update(vacancy)
    .set({
      responsesTotal: sql`coalesce(${counts.total}::int, ${vacancy.responsesTotal})`,
      responsesVacancy: sql`coalesce(${counts.vacancy}::int, ${vacancy.responsesVacancy})`
    })
    .where(sql`${vacancy.id} = ${id}`)
    .pipe(
      Effect.andThen(
        insertResponseSample(tx, { vacancyId: id, total: counts.total, vacancy: counts.vacancy })
      )
    )

export const touch = (tx: Executor, id: string) =>
  tx
    .update(vacancy)
    .set({ lastSeenAt: new Date() })
    .where(sql`${vacancy.id} = ${id}`)
    .pipe(Effect.asVoid)

export const insertResponseSample = (
  tx: Executor,
  input: {
    readonly vacancyId: string
    readonly total: number | null
    readonly vacancy: number | null
    readonly source?: string
  }
) => {
  if (input.total === null && input.vacancy === null) return Effect.void
  const bucket = new Date().toISOString().slice(0, 10)
  return tx
    .insert(vacancyResponseSample)
    .values({
      vacancyId: input.vacancyId,
      bucket,
      total: input.total,
      vacancyCount: input.vacancy,
      source: input.source ?? "hh"
    })
    .onConflictDoUpdate({
      target: [vacancyResponseSample.vacancyId, vacancyResponseSample.bucket],
      set: { total: sql`excluded.total`, vacancyCount: sql`excluded.vacancy` }
    })
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export const rowSelection = {
  id: vacancy.id,
  responsesTotal: vacancy.responsesTotal,
  responsesVacancy: vacancy.responsesVacancy,
  source: vacancy.source,
  externalId: vacancy.externalId,
  canonicalUrl: vacancy.canonicalUrl,
  title: vacancy.title,
  employerId: vacancy.employerId,
  employerExternalId: employer.externalId,
  employerName: employer.name,
  employerRating: employer.rating,
  employerLogoUrl: employer.logoUrl,
  areaName: vacancy.areaName,
  salaryFrom: vacancy.salaryFrom,
  salaryTo: vacancy.salaryTo,
  salaryCurrency: vacancy.salaryCurrency,
  seniority: vacancy.seniority,
  experienceCode: vacancy.experienceCode,
  employmentForm: vacancy.employmentForm,
  publishedAt: vacancy.publishedAt,
  archived: vacancy.archived,
  createdAt: vacancy.createdAt,
  lastSeenAt: vacancy.lastSeenAt,
  contentHash: vacancy.contentHash,
  descriptionText: vacancy.descriptionText,
  descriptionHtml: vacancy.descriptionHtml,
  workFormats: vacancy.workFormats,
  blacklistLayers: sql<ReadonlyArray<string>>`'[]'::json`,
  letterRequired: sql<boolean | null>`(${vacancy.signals} -> 'hh' ->> 'letterRequired')::boolean`,
  hasTest: sql<boolean | null>`(${vacancy.signals} -> 'hh' -> 'test' ->> 'hasTest')::boolean`,
  testRequired: sql<boolean | null>`(${vacancy.signals} -> 'hh' -> 'test' ->> 'required')::boolean`,
  responded: sql<ReadonlyArray<unknown>>`coalesce((
    select json_agg(json_build_object('accountId', r.hh_account_id, 'resumeIds', r.resume_ids))
    from (
      select ap.hh_account_id, json_agg(distinct ap.resume_id) as resume_ids
      from application ap
      where ap.vacancy_id = ${vacancy.id} and ap.state in ('submitted', 'submitting', 'queued', 'preparing')
      group by ap.hh_account_id
    ) r
  ), '[]'::json)`,
  analysisYearsMin: sql<number | null>`(
    select (a.facts->'yearsMin'->>'value')::float8 from vacancy_analysis a
    where a.vacancy_id = ${vacancy.id} and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}
  )`,
  analysisRole: sql<string | null>`(
    select a.facts->'role'->>'value' from vacancy_analysis a
    where a.vacancy_id = ${vacancy.id} and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}
  )`,
  analysed: sql<boolean>`exists (
    select 1 from vacancy_analysis a
    where a.vacancy_id = ${vacancy.id} and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}
  )`,
  skills: sql<ReadonlyArray<string>>`coalesce((
    select json_agg(s.term order by s.position nulls last)
    from vacancy_skill s where s.vacancy_id = ${vacancy.id}
  ), '[]'::json)`
}

export const findByExternal = (tx: Executor, source: string, externalId: string) => {
  const statement = sql`
    select ${sql.join(
      Object.entries(rowSelection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
      sql`, `
    )}
    from vacancy
    left join employer on employer.id = vacancy.employer_id
    where vacancy.source = ${source} and vacancy.external_id = ${externalId}
    limit 1
  `
  return tx.execute(statement).pipe(
    Effect.map((result) => (result.rows[0] as unknown as VacancyRow | undefined) ?? null)
  )
}

/** hh-only vacancy counters for the hydration dashboard. */
export const countHhProfile = (tx: Executor): RepoEffect<{
  readonly total: number
  readonly full: number
  readonly stub: number
}> =>
  tx
    .select({
      total: sql<number>`count(*)::int`,
      full: sql<number>`count(*) filter (where ${vacancy.hydrationStatus} = 'full'
        and ${vacancy.descriptionHtml} is not null
        and coalesce(length(btrim(${vacancy.descriptionText})), 0) >= ${HYDRATION_MIN_DESCRIPTION})::int`,
      stub: sql<number>`count(*) filter (where not (${vacancy.hydrationStatus} = 'full'
        and ${vacancy.descriptionHtml} is not null
        and coalesce(length(btrim(${vacancy.descriptionText})), 0) >= ${HYDRATION_MIN_DESCRIPTION}))::int`
    })
    .from(vacancy)
    .where(eq(vacancy.source, "hh"))
    .pipe(
      Effect.map((rows) => ({
        total: Number(rows[0]?.total ?? 0),
        full: Number(rows[0]?.full ?? 0),
        stub: Number(rows[0]?.stub ?? 0)
      }))
    )

export interface HydrationFilter {
  readonly limit?: number
  readonly minDescriptionLength?: number
  /**
   * Skip targets that failed recently. The operator UI lists the whole queue,
   * but a hydration pass must only take targets whose retry time has come.
   */
  readonly onlyDue?: boolean
  /**
   * Backfill mode: instead of stubs, list complete, non-archived vacancies whose
   * hh response signals (letter required, test, schedule) were never captured.
   */
  readonly missingHhSignals?: boolean
  /**
   * Backfill mode: complete, non-archived vacancies without a response count.
   * Only the vacancy page carries it, and a search upsert used to erase it.
   */
  readonly missingResponses?: boolean
}

/**
 * Hydration candidates: stored stubs, newest first. The predicate mirrors
 * `needsHydration`; `hydration_status` makes the intent readable in the table
 * while the length check keeps rows ingested before status tracking working.
 */
export const listNeedingHydration = (tx: Executor, filter: HydrationFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
  const min = Math.max(0, filter.minDescriptionLength ?? HYDRATION_MIN_DESCRIPTION)

  return tx
    .select({
      id: vacancy.id,
      source: vacancy.source,
      externalId: vacancy.externalId,
      canonicalUrl: vacancy.canonicalUrl,
      title: vacancy.title,
      descriptionLength: sql<number>`coalesce(length(btrim(${vacancy.descriptionText})), 0)::int`,
      employerName: employer.name,
      areaName: vacancy.areaName,
      publishedAt: vacancy.publishedAt,
      lastSeenAt: vacancy.lastSeenAt
    })
    .from(vacancy)
    .leftJoin(employer, eq(vacancy.employerId, employer.id))
    .where(sql`
      ${vacancy.source} = 'hh'
      and ${filter.missingResponses === true
        ? sql`(
            ${vacancy.hydrationStatus} = 'full'
            and ${vacancy.descriptionHtml} is not null
            and coalesce(length(btrim(${vacancy.descriptionText})), 0) >= ${min}
            and not ${vacancy.archived}
            and ${vacancy.responsesTotal} is null
          )`
        : filter.missingHhSignals === true
        ? sql`(
            ${vacancy.hydrationStatus} = 'full'
            and ${vacancy.descriptionHtml} is not null
            and coalesce(length(btrim(${vacancy.descriptionText})), 0) >= ${min}
            and not ${vacancy.archived}
            and (${vacancy.signals} -> 'hh') is null
          )`
        : sql`(
            ${vacancy.hydrationStatus} <> 'full'
            or ${vacancy.descriptionHtml} is null
            or coalesce(length(btrim(${vacancy.descriptionText})), 0) < ${min}
          )`}
      ${filter.onlyDue === true
        ? sql`and ${HydrationAttemptRepository.notDeferredSql("vacancy", sql`${vacancy.id}`)}`
        : sql``}
    `)
    .orderBy(sql`${vacancy.lastSeenAt} desc`, vacancy.id)
    .limit(limit)
    .pipe(
      Effect.map((rows) =>
        rows.map(
          (row): HydrationTarget => ({
            id: row.id as HydrationTarget["id"],
            source: row.source,
            externalId: row.externalId,
            canonicalUrl: row.canonicalUrl,
            title: row.title,
            descriptionLength: Number(row.descriptionLength),
            employerName: row.employerName ?? null,
            areaName: row.areaName ?? null,
            publishedAt: row.publishedAt?.toISOString() ?? null,
            lastSeenAt: row.lastSeenAt?.toISOString() ?? null
          })
        )
      )
    )
}

export interface VacancyFilter {
  readonly limit?: number
  readonly offset?: number
  readonly includeArchived?: boolean
  /** `true`: only vacancies with an analysis for the current prompt version; `false`: only without. */
  readonly analysed?: boolean
  /** Only vacancies with an active response from this hh account. */
  readonly respondedAccountId?: string
  /** Case-insensitive substring of title, employer name or city. */
  readonly search?: string
  readonly sort?: { readonly key: VacancySortKey; readonly direction: "asc" | "desc" }
  /**
   * Default `false`: hide rows matched by an applicable blacklist layer.
   * `true` keeps them and labels the summary instead.
   */
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
  /** Область решений: резюме внутри аккаунта; без него берётся свежее решение аккаунта. */
  readonly resumeId?: string
  readonly verdict?: "apply" | "draft" | "skip" | "none"
  /** `yes`: у аккаунта области есть действующий отклик; `no`: нет. */
  readonly applied?: "yes" | "no"
  /** ISO-время: `vacancy.created_at >= seenSince`. Непарсящееся значение игнорируется. */
  readonly seenSince?: string
  /** ISO-время только для счётчика `fresh`; выдачу не сужает. Без него берётся `seenSince`. */
  readonly freshSince?: string
  /** Set by the service; RLS already scopes `hidden_target` to this user. */
  readonly userId?: string
  /**
   * A compiled preset filter over the `vacancy` table, ANDed with the list's
   * own archive and blacklist toggles.
   */
  readonly extraWhere?: SQL
}

/** `%term%` with LIKE wildcards in the term escaped, for `ilike ... escape '\\'`. */
const likePattern = (term: string): string => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/** Отклик считается действующим в этих состояниях (так же, как поле `responded`). */
const ACTIVE_RESPONSE_STATES = sql`('submitted', 'submitting', 'queued', 'preparing')`

/**
 * Область решений и откликов списка: явный `hhAccountId`, иначе основной аккаунт
 * пользователя (`is_default`, затем самый ранний). Нет аккаунтов - `null`.
 */
const resolveScopeAccount = (tx: Executor, filter: VacancyFilter): RepoEffect<string | null> =>
  filter.hhAccountId !== undefined
    ? Effect.succeed(filter.hhAccountId)
    : filter.userId === undefined
      ? Effect.succeed(null)
      : tx
          .execute(sql`
            select id from hh_account
            where user_id = ${filter.userId}
            order by is_default desc, created_at asc
            limit 1
          `)
          .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

export const list = (tx: Executor, filter: VacancyFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const archivedClause = filter.includeArchived === true ? sql`true` : sql`not vacancy.archived`
  const extraClause = filter.extraWhere === undefined ? sql`true` : sql`(${filter.extraWhere})`

  const analysedExists = sql`exists (
    select 1 from vacancy_analysis a
    where a.vacancy_id = vacancy.id and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}
  )`
  const analysedClause =
    filter.analysed === undefined ? sql`true` : filter.analysed ? analysedExists : sql`not ${analysedExists}`

  const respondedClause =
    filter.respondedAccountId === undefined
      ? sql`true`
      : sql`exists (
          select 1 from application ap
          where ap.vacancy_id = vacancy.id
            and ap.hh_account_id = ${filter.respondedAccountId}
            and ap.state in ${ACTIVE_RESPONSE_STATES}
        )`

  const searchTerm = filter.search?.trim() ?? ""
  const searchClause =
    searchTerm === ""
      ? sql`true`
      : sql`(
          vacancy.title ilike ${likePattern(searchTerm)} escape '\\'
          or employer.name ilike ${likePattern(searchTerm)} escape '\\'
          or vacancy.area_name ilike ${likePattern(searchTerm)} escape '\\'
        )`

  const blacklistInput = {
    userId: filter.userId,
    hhAccountId: filter.hhAccountId ?? null,
    employerExternalId: sql`employer.external_id`,
    vacancyExternalId: sql`vacancy.external_id`
  }
  const sortExpressions: Record<VacancySortKey, SQL> = {
    title: sql`lower(vacancy.title)`,
    employer: sql`lower(employer.name)`,
    rating: sql`employer.rating`,
    salary: sql`coalesce(vacancy.salary_from, vacancy.salary_to)`,
    area: sql`lower(vacancy.area_name)`,
    seniority: sql`case vacancy.seniority when 'junior' then 1 when 'middle' then 2 when 'senior' then 3 when 'lead' then 4 else null end`,
    experience: sql`case vacancy.experience_code when 'noExperience' then 0 when 'between1And3' then 1 when 'between3And6' then 2 when 'moreThan6' then 3 else null end`,
    employment: sql`vacancy.employment_form`,
    date: sql`coalesce(vacancy.published_at, vacancy.last_seen_at)`,
    firstSeen: sql`vacancy.created_at`,
    lastSeen: sql`vacancy.last_seen_at`,
    archived: sql`vacancy.archived`,
    blacklisted: BlacklistRepository.matchExistsSql(blacklistInput),
    responses: sql`vacancy.responses_total`,
    analysed: analysedExists,
    // Решение области: без решения значение null и строка уходит в конец (`nulls last`).
    fit: sql`dec.fit`,
    priority: sql`dec.live_priority`
  }
  const orderBy = filter.sort === undefined
    ? sql`vacancy.published_at desc nulls last, vacancy.created_at desc, vacancy.id`
    : sql`${sortExpressions[filter.sort.key]} ${sql.raw(filter.sort.direction === "asc" ? "asc" : "desc")} nulls last,
          vacancy.published_at desc nulls last, vacancy.created_at desc, vacancy.id`

  const blacklistClause =
    filter.includeBlacklisted === true
      ? sql`true`
      : sql`not ${BlacklistRepository.matchExistsSql(blacklistInput)}`

  const seenSince = filter.seenSince === undefined ? null : new Date(filter.seenSince)
  const seenSinceValid = seenSince !== null && !Number.isNaN(seenSince.getTime())
  // Граница счётчика «Новые» отдельна от фильтра: счётчик нужен и при выдаче без него.
  const freshRaw = filter.freshSince === undefined ? null : new Date(filter.freshSince)
  const freshSince = freshRaw !== null && !Number.isNaN(freshRaw.getTime()) ? freshRaw : seenSinceValid ? seenSince : null

  const verdictClause =
    filter.verdict === undefined
      ? sql`true`
      : filter.verdict === "none"
        ? sql`dec.verdict is null`
        : sql`dec.verdict = ${filter.verdict}`
  const appliedClause =
    filter.applied === undefined
      ? sql`true`
      : filter.applied === "yes"
        ? sql`app.state in ${ACTIVE_RESPONSE_STATES}`
        : sql`(app.state is null or app.state not in ${ACTIVE_RESPONSE_STATES})`
  const seenClause = seenSinceValid ? sql`vacancy.created_at >= ${seenSince!.toISOString()}::timestamptz` : sql`true`

  const selection = {
    ...rowSelection,
    blacklistLayers: BlacklistRepository.layersSql(blacklistInput),
    decVerdict: sql`dec.verdict`,
    decFit: sql`dec.fit`,
    decPriority: sql`dec.live_priority`,
    decResumeId: sql`dec.resume_id::text`,
    decReason: sql`dec.top_reason`,
    appId: sql`app.id`,
    appState: sql`app.state`,
    appBlockedReason: sql`app.blocked_reason`,
    appHhStatus: sql`app.hh_status`,
    appAutoRun: sql`app.auto_run`
  }

  return Effect.gen(function*() {
    const scopeAccountId = yield* resolveScopeAccount(tx, filter)
    // Без аккаунта или пользователя решений и откликов нет: боковые запросы пусты.
    const scoped = scopeAccountId !== null && filter.userId !== undefined
    const resumeDec = filter.resumeId === undefined ? sql`true` : sql`d.resume_id = ${filter.resumeId}`
    const resumeApp = filter.resumeId === undefined ? sql`true` : sql`ap.resume_id = ${filter.resumeId}`

    // Одно боковое соединение на вакансию: без N+1. Берётся самое свежее решение
    // области; из откликов - действующий, затем требующий внимания, затем остальные.
    const joins = scoped
      ? sql`
      left join lateral (
        select d.verdict, d.fit, d.resume_id, ${livePriorityExpr} as live_priority,
          (select jsonb_build_object('code', t.r ->> 'code', 'detail', t.r ->> 'detail')
             from jsonb_array_elements(d.reasons) with ordinality as t(r, n)
            order by (case when t.r ->> 'code' like 'blocked\\_%' then 0 else 1 end), t.n
            limit 1) as top_reason
        from decision d
        where d.user_id = ${filter.userId} and d.vacancy_id = vacancy.id
          and d.hh_account_id = ${scopeAccountId} and ${resumeDec}
        order by d.created_at desc, d.id desc
        limit 1
      ) dec on true
      left join lateral (
        select ap.id, ap.state, ap.blocked_reason, ap.hh_status, ap.auto_run
        from application ap
        where ap.user_id = ${filter.userId} and ap.vacancy_id = vacancy.id
          and ap.hh_account_id = ${scopeAccountId} and ${resumeApp}
        order by (case when ap.state in ${ACTIVE_RESPONSE_STATES} then 0
                       when ap.state in ('draft', 'needs_human') then 1 else 2 end),
                 ap.updated_at desc, ap.id desc
        limit 1
      ) app on true`
      : sql`
      left join lateral (
        select null::text as verdict, null::int as fit, null::uuid as resume_id,
          null::float8 as live_priority, null::jsonb as top_reason where false
      ) dec on true
      left join lateral (
        select null::uuid as id, null::text as state, null::text as blocked_reason,
          null::text as hh_status, null::text as auto_run where false
      ) app on true`

    const baseWhere = sql`${archivedClause} and ${analysedClause} and ${respondedClause} and ${searchClause} and ${blacklistClause} and ${extraClause}`

    const rows = yield* tx.execute(sql`
      select ${sql.join(
        Object.entries(selection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
        sql`, `
      )}
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      ${joins}
      where ${baseWhere} and ${verdictClause} and ${appliedClause} and ${seenClause}
      order by ${orderBy}
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      ${joins}
      where ${baseWhere} and ${verdictClause} and ${appliedClause} and ${seenClause}
    `)

    // Счётчики быстрых фильтров: тот же набор без verdict / applied / seenSince.
    const counts = yield* tx.execute(sql`
      select count(*)::int as "all",
        (count(*) filter (where dec.verdict = 'apply'))::int as apply,
        (count(*) filter (where app.state in ${ACTIVE_RESPONSE_STATES}))::int as applied,
        (count(*) filter (where app.state is null or app.state not in ${ACTIVE_RESPONSE_STATES}))::int as not_applied,
        ${freshSince !== null
          ? sql`(count(*) filter (where vacancy.created_at >= ${freshSince.toISOString()}::timestamptz))::int`
          : sql`null::int`} as fresh
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      ${joins}
      where ${baseWhere}
    `)
    const countRow = counts.rows[0] as
      | { all?: number; apply?: number; applied?: number; not_applied?: number; fresh?: number | null }
      | undefined

    return {
      items: (rows.rows as unknown as ReadonlyArray<VacancyRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0),
      scopeHhAccountId: scopeAccountId as HhAccountId | null,
      counts: {
        all: Number(countRow?.all ?? 0),
        apply: Number(countRow?.apply ?? 0),
        applied: Number(countRow?.applied ?? 0),
        notApplied: Number(countRow?.not_applied ?? 0),
        ...(countRow?.fresh == null ? {} : { fresh: Number(countRow.fresh) })
      }
    }
  })
}

export const findById = (tx: Executor, id: string) =>
  tx
    .execute(sql`
      select ${sql.join(
        Object.entries(rowSelection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
        sql`, `
      )}
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      where vacancy.id = ${id}
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as unknown as VacancyRow | undefined) ?? null))

/** Vacancies of one employer, active first, for the company page. */
export const listByEmployer = (
  tx: Executor,
  employerId: string,
  limit = 100
): RepoEffect<ReadonlyArray<VacancySummary>> =>
  tx
    .execute(sql`
      select ${sql.join(
        Object.entries(rowSelection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
        sql`, `
      )}
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      where vacancy.employer_id = ${employerId} and not vacancy.archived
      order by vacancy.published_at desc nulls last, vacancy.created_at desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<VacancyRow>).map(toSummary)
      )
    )
