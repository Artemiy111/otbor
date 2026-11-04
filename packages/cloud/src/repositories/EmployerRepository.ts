import type { BlacklistScope, EmployerHydrationMissing, EmployerHydrationTarget, EmployerSummary } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"
import * as HydrationAttemptRepository from "./HydrationAttemptRepository.ts"
import * as VacancyRepository from "./VacancyRepository.ts"

export interface EmployerRow {
  readonly id: string
  readonly source: string
  readonly external_id: string
  readonly name: string
  readonly rating: number | null
  readonly reviews_count: number | null
  readonly recommendations_percent: number | null
  readonly site_url: string | null
  readonly logo_url: string | null
  readonly industries: ReadonlyArray<string>
  readonly vacancy_count: number
  readonly blacklist_layers?: ReadonlyArray<BlacklistScope> | null
}

export const toSummary = (row: EmployerRow): EmployerSummary => {
  const blacklistLayers = [...(row.blacklist_layers ?? [])]
  return {
    id: row.id as EmployerSummary["id"],
    source: row.source,
    externalId: row.external_id,
    name: row.name,
    rating: row.rating,
    reviewsCount: row.reviews_count,
    recommendationsPercent: row.recommendations_percent,
    siteUrl: row.site_url,
    logoUrl: row.logo_url,
    industries: row.industries,
    vacancyCount: Number(row.vacancy_count),
    blacklisted: blacklistLayers.length > 0,
    blacklistLayers
  }
}

const selection = (options: {
  readonly userId?: string
  readonly hhAccountId?: string | null
}) => sql`
  select e.id, e.source, e.external_id, e.name, e.rating, e.reviews_count,
         e.recommendations_percent, e.site_url, e.logo_url, e.industries,
         count(v.id) filter (where not v.archived)::int as vacancy_count,
         ${BlacklistRepository.layersSql({
           userId: options.userId,
           hhAccountId: options.hhAccountId ?? null,
           employerExternalId: sql`e.external_id`,
           vacancyExternalId: sql`null::text`
         })} as blacklist_layers
  from employer e
  left join vacancy v on v.employer_id = e.id
`

export interface EmployerFilter {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
  readonly userId?: string
}

export const list = (tx: Executor, filter: EmployerFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const query = filter.query?.trim() ?? ""
  const pattern = query === "" ? null : `%${query.replace(/[%_]/g, "\\$&")}%`
  const nameClause = pattern === null ? sql`true` : sql`e.name ilike ${pattern}`
  const blacklistClause = filter.includeBlacklisted === true
    ? sql`true`
    : sql`not ${BlacklistRepository.matchExistsSql({
        userId: filter.userId,
        hhAccountId: filter.hhAccountId ?? null,
        employerExternalId: sql`e.external_id`,
        vacancyExternalId: sql`null::text`
      })}`

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      ${selection(filter)}
      where ${nameClause} and ${blacklistClause}
      group by e.id
      order by vacancy_count desc, e.name
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count from employer e
      where ${nameClause} and ${blacklistClause}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<EmployerRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })
}

export const findById = (
  tx: Executor,
  id: string,
  options: { readonly userId?: string; readonly hhAccountId?: string | null } = {}
) =>
  tx
    .execute(sql`
      ${selection(options)}
      where e.id = ${id}
      group by e.id
      limit 1
    `)
    .pipe(
      Effect.flatMap((result) => {
        const row = result.rows[0] as unknown as EmployerRow | undefined
        if (row === undefined) return Effect.succeed(null)
        return VacancyRepository.listByEmployer(tx, id).pipe(
          Effect.map((vacancies) => ({ employer: toSummary(row), vacancies }))
        )
      })
    )

interface EmployerTargetRow {
  readonly id: string
  readonly source: string
  readonly external_id: string
  readonly name: string
  readonly rating: number | null
  readonly reviews_count: number | null
  readonly recommendations_percent: number | null
  readonly site_url: string | null
  readonly logo_url: string | null
  readonly industries: unknown
  readonly updated_at: string | Date
  readonly vacancy_count: number | string
}

const toTarget = (row: EmployerTargetRow): EmployerHydrationTarget => {
  const industries = industriesOf(row.industries)
  const missing: Array<EmployerHydrationMissing> = []
  if (row.rating === null) missing.push("rating")
  if (row.site_url === null || row.site_url.trim() === "") missing.push("siteUrl")
  if (row.logo_url === null || row.logo_url.trim() === "") missing.push("logoUrl")
  if (industries.length === 0) missing.push("industries")
  return {
    id: row.id as EmployerHydrationTarget["id"],
    source: row.source,
    externalId: row.external_id,
    name: row.name,
    rating: row.rating,
    reviewsCount: row.reviews_count,
    recommendationsPercent: row.recommendations_percent,
    siteUrl: row.site_url,
    logoUrl: row.logo_url,
    industries,
    vacancyCount: Number(row.vacancy_count),
    updatedAt: isoOf(row.updated_at),
    missing
  }
}

const industriesOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const isoOf = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

const targetValues = (result: { readonly rows: unknown }) =>
  (result.rows as unknown as ReadonlyArray<EmployerTargetRow>).map(toTarget)

/**
 * Bounded refresh queue: only employers that actually back a vacancy, oldest
 * profile first. The scheduler never walks the whole employer table.
 */
export const listForRefresh = (
  tx: Executor,
  options: { readonly limit?: number; readonly onlyDue?: boolean } = {}
): RepoEffect<ReadonlyArray<EmployerHydrationTarget>> => {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
  return tx
    .execute(sql`
      select e.id, e.source, e.external_id, e.name, e.rating, e.reviews_count,
             e.recommendations_percent, e.site_url, e.logo_url, e.industries,
             e.updated_at,
             count(v.id) filter (where not v.archived)::int as vacancy_count
      from employer e
      left join vacancy v on v.employer_id = e.id
      where e.source = 'hh'
        ${options.onlyDue === true
          ? sql`and ${HydrationAttemptRepository.notDeferredSql("employer", sql`e.id`)}`
          : sql``}
      group by e.id
      having count(v.id) > 0
      order by e.updated_at asc, e.id
      limit ${limit}
    `)
    .pipe(Effect.map(targetValues))
}

/** One refresh target by id; used by the manual "refresh profile" action. */
export const findTargetById = (
  tx: Executor,
  id: string
): RepoEffect<EmployerHydrationTarget | null> =>
  tx
    .execute(sql`
      select e.id, e.source, e.external_id, e.name, e.rating, e.reviews_count,
             e.recommendations_percent, e.site_url, e.logo_url, e.industries,
             e.updated_at,
             count(v.id) filter (where not v.archived)::int as vacancy_count
      from employer e
      left join vacancy v on v.employer_id = e.id
      where e.source = 'hh' and e.id = ${id}
      group by e.id
    `)
    .pipe(Effect.map((result) => targetValues(result)[0] ?? null))

/** hh-only employer counters for the hydration dashboard. */
export const countHhProfile = (tx: Executor): RepoEffect<{
  readonly total: number
  readonly linked: number
  readonly withoutRating: number
  readonly withoutSite: number
  readonly withoutLogo: number
  readonly withoutIndustries: number
  readonly stale30Days: number
}> =>
  tx
    .execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where exists (
          select 1 from vacancy v where v.employer_id = e.id
        ))::int as linked,
        count(*) filter (where e.rating is null)::int as without_rating,
        count(*) filter (where e.site_url is null or btrim(e.site_url) = '')::int as without_site,
        count(*) filter (where e.logo_url is null or btrim(e.logo_url) = '')::int as without_logo,
        count(*) filter (where e.industries is null or e.industries = '[]'::jsonb)::int as without_industries,
        count(*) filter (where e.updated_at < now() - interval '30 days')::int as stale_30_days
      from employer e
      where e.source = 'hh'
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as {
          total?: number | string
          linked?: number | string
          without_rating?: number | string
          without_site?: number | string
          without_logo?: number | string
          without_industries?: number | string
          stale_30_days?: number | string
        } | undefined
        return {
          total: Number(row?.total ?? 0),
          linked: Number(row?.linked ?? 0),
          withoutRating: Number(row?.without_rating ?? 0),
          withoutSite: Number(row?.without_site ?? 0),
          withoutLogo: Number(row?.without_logo ?? 0),
          withoutIndustries: Number(row?.without_industries ?? 0),
          stale30Days: Number(row?.stale_30_days ?? 0)
        }
      })
    )

export interface EmployerProfilePatch {
  readonly name?: string | null
  readonly rating?: number | null
  readonly reviewsCount?: number | null
  readonly recommendationsPercent?: number | null
  readonly siteUrl?: string | null
  readonly logoUrl?: string | null
  readonly industries?: ReadonlyArray<string>
}

export const applyProfile = (
  tx: Executor,
  id: string,
  patch: EmployerProfilePatch
): RepoEffect<void> =>
  tx
    .execute(sql`
      update employer as e set
        name = coalesce(${patch.name ?? null}, e.name),
        rating = coalesce(${patch.rating ?? null}, e.rating),
        reviews_count = coalesce(${patch.reviewsCount ?? null}, e.reviews_count),
        recommendations_percent = coalesce(${patch.recommendationsPercent ?? null}, e.recommendations_percent),
        site_url = coalesce(${patch.siteUrl ?? null}, e.site_url),
        logo_url = coalesce(${patch.logoUrl ?? null}, e.logo_url),
        industries = case
          when ${JSON.stringify(patch.industries ?? [])}::jsonb = '[]'::jsonb then e.industries
          else ${JSON.stringify(patch.industries ?? [])}::jsonb
        end,
        -- A page that only repeats what we already store must not push the
        -- company to the back of the oldest-first queue for another month.
        updated_at = case
          when row(
            e.name, e.rating, e.reviews_count, e.recommendations_percent,
            e.site_url, e.logo_url, e.industries
          ) is distinct from row(
            coalesce(${patch.name ?? null}, e.name),
            coalesce(${patch.rating ?? null}, e.rating),
            coalesce(${patch.reviewsCount ?? null}, e.reviews_count),
            coalesce(${patch.recommendationsPercent ?? null}, e.recommendations_percent),
            coalesce(${patch.siteUrl ?? null}, e.site_url),
            coalesce(${patch.logoUrl ?? null}, e.logo_url),
            case
              when ${JSON.stringify(patch.industries ?? [])}::jsonb = '[]'::jsonb then e.industries
              else ${JSON.stringify(patch.industries ?? [])}::jsonb
            end
          )
          then now()
          else e.updated_at
        end
      where e.id = ${id}
    `)
    .pipe(Effect.asVoid)
