import type { BlacklistScope, EmployerBlacklistView, EmployerProfile, EmployerHydrationMissing, EmployerHydrationTarget, EmployerSummary } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
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
  readonly responded_account_ids?: ReadonlyArray<string> | null
  readonly blacklist_layers?: ReadonlyArray<BlacklistScope> | null
  readonly blocked_account_ids?: ReadonlyArray<string> | null
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
    respondedAccountIds: [...(row.responded_account_ids ?? [])] as EmployerSummary["respondedAccountIds"] & string[],
    blacklisted: blacklistLayers.length > 0,
    blacklistLayers,
    blockedAccountIds: [...(row.blocked_account_ids ?? [])] as EmployerSummary["blockedAccountIds"] & string[]
  }
}

/** Application states that count as "the account responded". */
const RESPONDED_STATES = "'submitted', 'submitting', 'queued', 'preparing'"

/**
 * Employer blocks are shown across every layer and every hh account, so the
 * companies page can say who blocked a company. `extra` narrows the rows.
 */
const employerBlockExists = (userId: string | undefined, extra: ReturnType<typeof sql>) =>
  userId === undefined
    ? sql`false`
    : sql`exists (
        select 1 from hidden_target ht
        where ht.user_id = ${userId}
          and ht.type = 'employer'
          and ht.external_id = e.external_id
          and ${extra}
      )`

const blockLayersSql = (userId: string | undefined) =>
  userId === undefined
    ? sql`'[]'::json`
    : sql`coalesce((
        select json_agg(distinct ht.scope order by ht.scope)
        from hidden_target ht
        where ht.user_id = ${userId} and ht.type = 'employer' and ht.external_id = e.external_id
      ), '[]'::json)`

const blockedAccountsSql = (userId: string | undefined) =>
  userId === undefined
    ? sql`'{}'::text[]`
    : sql`coalesce((
        select array_agg(distinct ht.hh_account_id::text)
        from hidden_target ht
        where ht.user_id = ${userId} and ht.type = 'employer' and ht.external_id = e.external_id
          and ht.scope in ('hh_account', 'hh_native') and ht.hh_account_id is not null
      ), '{}')`

const selection = (options: {
  readonly userId?: string
  readonly hhAccountId?: string | null
}) => sql`
  select e.id, e.source, e.external_id, e.name, e.rating, e.reviews_count,
         e.recommendations_percent, e.site_url, e.logo_url, e.industries,
         count(v.id) filter (where not v.archived)::int as vacancy_count,
         coalesce((
           select array_agg(distinct a.hh_account_id::text)
           from application a join vacancy av on av.id = a.vacancy_id
           where av.employer_id = e.id and a.state in (${sql.raw(RESPONDED_STATES)})
         ), '{}') as responded_account_ids,
         ${blockLayersSql(options.userId)} as blacklist_layers,
         ${blockedAccountsSql(options.userId)} as blocked_account_ids
  from employer e
  left join vacancy v on v.employer_id = e.id
`

export interface EmployerFilter {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
  readonly includeBlacklisted?: boolean
  readonly blacklistView?: EmployerBlacklistView
  readonly blockedByAccountId?: string
  readonly hhAccountId?: string
  /** Only employers this account responded to. */
  readonly respondedAccountId?: string
  readonly userId?: string
}

export const list = (tx: Executor, filter: EmployerFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const query = filter.query?.trim() ?? ""
  const pattern = query === "" ? null : `%${query.replace(/[%_]/g, "\\$&")}%`
  const nameClause = pattern === null ? sql`true` : sql`e.name ilike ${pattern}`
  const view: EmployerBlacklistView = filter.blacklistView ??
    (filter.includeBlacklisted === true ? "all" : "hide")
  const blacklistClause = (() => {
    switch (view) {
      case "all":
        return sql`true`
      case "hide":
        return sql`not ${employerBlockExists(filter.userId, sql`true`)}`
      case "only":
        return employerBlockExists(filter.userId, sql`true`)
      case "app":
        return employerBlockExists(filter.userId, sql`ht.scope = 'app'`)
      case "account":
        return employerBlockExists(
          filter.userId,
          filter.blockedByAccountId === undefined
            ? sql`ht.scope in ('hh_account', 'hh_native')`
            : sql`ht.scope in ('hh_account', 'hh_native') and ht.hh_account_id = ${filter.blockedByAccountId}::uuid`
        )
    }
  })()

  const respondedClause = filter.respondedAccountId === undefined
    ? sql`true`
    : sql`exists (
        select 1 from application a join vacancy av on av.id = a.vacancy_id
        where av.employer_id = e.id
          and a.hh_account_id = ${filter.respondedAccountId}::uuid
          and a.state in (${sql.raw(RESPONDED_STATES)})
      )`

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      ${selection(filter)}
      where ${nameClause} and ${blacklistClause} and ${respondedClause}
      group by e.id
      order by vacancy_count desc, e.name
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count from employer e
      where ${nameClause} and ${blacklistClause} and ${respondedClause}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<EmployerRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })
}

const profileSelect = sql`
  select e.category, e.size_category, e.address, e.site_host, e.description_text,
         e.badges, e.trusted, e.accredited_it, e.active_vacancies, e.profile_fetched_at
  from employer e
`

const toProfile = (row: Record<string, unknown>): EmployerProfile | null => {
  if (row.profile_fetched_at === null || row.profile_fetched_at === undefined) return null
  const text = (value: unknown) => (typeof value === "string" ? value : null)
  const flag = (value: unknown) => (typeof value === "boolean" ? value : null)
  const int = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  const badges = Array.isArray(row.badges) ? row.badges : []
  return {
    category: text(row.category),
    sizeCategory: text(row.size_category),
    address: text(row.address),
    siteHost: text(row.site_host),
    descriptionText: text(row.description_text),
    badges: badges.map((item) => {
      const badge = (item ?? {}) as Record<string, unknown>
      return {
        type: text(badge.type),
        description: text(badge.description),
        url: text(badge.url),
        year: int(badge.year)
      }
    }),
    trusted: flag(row.trusted),
    accreditedIt: flag(row.accredited_it),
    activeVacancies: int(row.active_vacancies),
    fetchedAt: isoOf(row.profile_fetched_at)
  }
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
        return tx.execute(sql`${profileSelect} where e.id = ${id}`).pipe(
          Effect.flatMap((profileResult) =>
            VacancyRepository.listByEmployer(tx, id).pipe(
              Effect.map((vacancies) => ({
                employer: toSummary(row),
                profile: toProfile((profileResult.rows[0] ?? {}) as Record<string, unknown>),
                vacancies
              }))
            )
          )
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
  readonly category?: string | null
  readonly sizeCategory?: string | null
  readonly address?: string | null
  readonly siteHost?: string | null
  readonly descriptionText?: string | null
  readonly badges?: ReadonlyArray<unknown>
  readonly trusted?: boolean | null
  readonly accreditedIt?: boolean | null
  readonly activeVacancies?: number | null
}

/**
 * Profile write. A field the page did not carry keeps the stored value
 * (`coalesce`), so a thinner page never wipes a fuller one.
 */
export const applyProfile = (
  tx: Executor,
  id: string,
  patch: EmployerProfilePatch
): RepoEffect<void> => {
  const industries = JSON.stringify(patch.industries ?? [])
  const badges = JSON.stringify(patch.badges ?? [])

  // Same expression is used for the update and for the "did anything change" check.
  const keep = (column: ReturnType<typeof sql.raw>, value: unknown) =>
    sql`coalesce(${value ?? null}, ${column})`
  const col = (name: string) => sql.raw(`e.${name}`)
  const newIndustries = sql`case when ${industries}::jsonb = '[]'::jsonb then e.industries else ${industries}::jsonb end`
  const newBadges = sql`case when ${badges}::jsonb = '[]'::jsonb then e.badges else ${badges}::jsonb end`

  return tx
    .execute(sql`
      update employer as e set
        name = ${keep(col("name"), patch.name)},
        rating = ${keep(col("rating"), patch.rating)},
        reviews_count = ${keep(col("reviews_count"), patch.reviewsCount)},
        recommendations_percent = ${keep(col("recommendations_percent"), patch.recommendationsPercent)},
        site_url = ${keep(col("site_url"), patch.siteUrl)},
        logo_url = ${keep(col("logo_url"), patch.logoUrl)},
        industries = ${newIndustries},
        category = ${keep(col("category"), patch.category)},
        size_category = ${keep(col("size_category"), patch.sizeCategory)},
        address = ${keep(col("address"), patch.address)},
        site_host = ${keep(col("site_host"), patch.siteHost)},
        description_text = ${keep(col("description_text"), patch.descriptionText)},
        badges = ${newBadges},
        trusted = ${keep(col("trusted"), patch.trusted)},
        accredited_it = ${keep(col("accredited_it"), patch.accreditedIt)},
        active_vacancies = ${keep(col("active_vacancies"), patch.activeVacancies)},
        profile_fetched_at = now(),
        -- A page that only repeats what we already store must not push the
        -- company to the back of the oldest-first queue for another month.
        updated_at = case
          when row(
            e.name, e.rating, e.reviews_count, e.recommendations_percent,
            e.site_url, e.logo_url, e.industries, e.description_text,
            e.category, e.address
          ) is distinct from row(
            ${keep(col("name"), patch.name)},
            ${keep(col("rating"), patch.rating)},
            ${keep(col("reviews_count"), patch.reviewsCount)},
            ${keep(col("recommendations_percent"), patch.recommendationsPercent)},
            ${keep(col("site_url"), patch.siteUrl)},
            ${keep(col("logo_url"), patch.logoUrl)},
            ${newIndustries},
            ${keep(col("description_text"), patch.descriptionText)},
            ${keep(col("category"), patch.category)},
            ${keep(col("address"), patch.address)}
          )
          then now()
          else e.updated_at
        end
      where e.id = ${id}
    `)
    .pipe(Effect.asVoid)
}
