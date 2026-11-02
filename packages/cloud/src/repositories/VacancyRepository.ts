import type { EmployerDraft, SalaryDraft, VacancyDraft, VacancySummary } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { employer, vacancy, vacancyResponseSample, vacancySkill, vacancySnapshot } from "../db/tables.ts"

export interface VacancyRow {
  readonly id: string
  readonly source: string
  readonly externalId: string
  readonly canonicalUrl: string
  readonly title: string
  readonly employerId: string | null
  readonly employerName: string | null
  readonly employerRating: number | null
  readonly areaName: string | null
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly seniority: string
  readonly publishedAt: Date | null
  readonly archived: boolean
  readonly createdAt: Date
  readonly lastSeenAt: Date
  readonly contentHash: string
  readonly descriptionText: string | null
  readonly descriptionHtml: string | null
  readonly workFormats: ReadonlyArray<string>
  readonly skills: ReadonlyArray<string>
}

export const toSummary = (row: VacancyRow): VacancySummary => ({
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
  publishedAt: row.publishedAt?.toISOString() ?? null,
  archived: row.archived,
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString()
})

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
    contentHash: input.contentHash,
    responsesTotal: draft.responsesTotal ?? null,
    responsesVacancy: draft.responsesVacancy ?? null
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
        contentHash: sql`excluded.content_hash`,
        responsesTotal: sql`excluded.responses_total`,
        responsesVacancy: sql`excluded.responses_vacancy`,
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

const rowSelection = {
  id: vacancy.id,
  source: vacancy.source,
  externalId: vacancy.externalId,
  canonicalUrl: vacancy.canonicalUrl,
  title: vacancy.title,
  employerId: vacancy.employerId,
  employerName: employer.name,
  employerRating: employer.rating,
  areaName: vacancy.areaName,
  salaryFrom: vacancy.salaryFrom,
  salaryTo: vacancy.salaryTo,
  salaryCurrency: vacancy.salaryCurrency,
  seniority: vacancy.seniority,
  publishedAt: vacancy.publishedAt,
  archived: vacancy.archived,
  createdAt: vacancy.createdAt,
  lastSeenAt: vacancy.lastSeenAt,
  contentHash: vacancy.contentHash,
  descriptionText: vacancy.descriptionText,
  descriptionHtml: vacancy.descriptionHtml,
  workFormats: vacancy.workFormats,
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

export interface VacancyFilter {
  readonly limit?: number
  readonly offset?: number
  readonly includeArchived?: boolean
  readonly gate?: string
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

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select ${sql.join(
        Object.entries(rowSelection).map(([key, value]) => sql`${value} as ${sql.identifier(key)}`),
        sql`, `
      )}
      from vacancy
      left join employer on employer.id = vacancy.employer_id
      where ${archivedClause} and ${gateClause}
      order by vacancy.published_at desc nulls last, vacancy.created_at desc
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count
      from vacancy
      where ${archivedClause} and ${gateClause}
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
