import { HhVacancySignals as HhVacancySignalsSchema } from "@otbor/contract"
import type {
  BlacklistScope,
  HhVacancySignals,
  EmployerDraft,
  HydrationTarget,
  SalaryDraft,
  VacancyDraft,
  VacancySummary
} from "@otbor/contract"
import { eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { employer, vacancy, vacancyResponseSample, vacancySkill, vacancySnapshot } from "../db/tables.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"
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
}

export const toSummary = (row: VacancyRow): VacancySummary => {
  const blacklistLayers = [...(row.blacklistLayers ?? [])]
  return {
    id: row.id as VacancySummary["id"],
    source: row.source,
    externalId: row.externalId,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    employerId: row.employerId as VacancySummary["employerId"],
    employerName: row.employerName,
    employerRating: row.employerRating,
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
    blacklistLayers
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
        responsesTotal: sql`excluded.responses_total`,
        responsesVacancy: sql`excluded.responses_vacancy`,
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
      and (
        ${vacancy.hydrationStatus} <> 'full'
        or ${vacancy.descriptionHtml} is null
        or coalesce(length(btrim(${vacancy.descriptionText})), 0) < ${min}
      )
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
  readonly gate?: string
  /**
   * Default `false`: hide rows matched by an applicable blacklist layer.
   * `true` keeps them and labels the summary instead.
   */
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
  /** Set by the service; RLS already scopes `hidden_target` to this user. */
  readonly userId?: string
}

export const list = (tx: Executor, filter: VacancyFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const archivedClause = filter.includeArchived === true ? sql`true` : sql`not vacancy.archived`

  const gateClause =
    filter.gate === undefined || filter.gate === ""
      ? sql`true`
      : sql`exists (
          select 1 from title_verdict tv
          where tv.normalized_title = regexp_replace(lower(btrim(vacancy.title)), '\\s+', ' ', 'g')
            and tv.verdict = ${filter.gate}
        )`

  const blacklistInput = {
    userId: filter.userId,
    hhAccountId: filter.hhAccountId ?? null,
    employerExternalId: sql`employer.external_id`,
    vacancyExternalId: sql`vacancy.external_id`
  }
  const blacklistClause =
    filter.includeBlacklisted === true
      ? sql`true`
      : sql`not ${BlacklistRepository.matchExistsSql(blacklistInput)}`

  const selection = {
    ...rowSelection,
    blacklistLayers: BlacklistRepository.layersSql(blacklistInput)
  }

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select ${sql.join(
        Object.entries(selection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
        sql`, `
      )}
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      where ${archivedClause} and ${gateClause} and ${blacklistClause}
      order by vacancy.published_at desc nulls last, vacancy.created_at desc
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      where ${archivedClause} and ${gateClause} and ${blacklistClause}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<VacancyRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
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
