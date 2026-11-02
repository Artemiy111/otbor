import type { BlacklistScope, EmployerSummary } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"
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

export interface EmployerRefreshTarget {
  readonly id: string
  readonly externalId: string
  readonly name: string
}

/**
 * Bounded refresh queue: only employers that actually back a vacancy, oldest
 * profile first. The scheduler never walks the whole employer table.
 */
export const listForRefresh = (
  tx: Executor,
  options: { readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<EmployerRefreshTarget>> => {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
  return tx
    .execute(sql`
      select e.id, e.external_id, e.name
      from employer e
      where e.source = 'hh'
        and exists (select 1 from vacancy v where v.employer_id = e.id)
      order by e.updated_at asc, e.id
      limit ${limit}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{
          id: string
          external_id: string
          name: string
        }>).map((row) => ({
          id: row.id,
          externalId: row.external_id,
          name: row.name
        }))
      )
    )
}

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
      update employer set
        name = coalesce(${patch.name ?? null}, name),
        rating = coalesce(${patch.rating ?? null}, rating),
        reviews_count = coalesce(${patch.reviewsCount ?? null}, reviews_count),
        recommendations_percent = coalesce(${patch.recommendationsPercent ?? null}, recommendations_percent),
        site_url = coalesce(${patch.siteUrl ?? null}, site_url),
        logo_url = coalesce(${patch.logoUrl ?? null}, logo_url),
        industries = case
          when ${JSON.stringify(patch.industries ?? [])}::jsonb = '[]'::jsonb then industries
          else ${JSON.stringify(patch.industries ?? [])}::jsonb
        end,
        updated_at = now()
      where id = ${id}
    `)
    .pipe(Effect.asVoid)
