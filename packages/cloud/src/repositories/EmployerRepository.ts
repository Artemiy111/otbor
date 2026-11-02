import type { EmployerSummary } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
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
}

export const toSummary = (row: EmployerRow): EmployerSummary => ({
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
  vacancyCount: Number(row.vacancy_count)
})

const selection = sql`
  select e.id, e.source, e.external_id, e.name, e.rating, e.reviews_count,
         e.recommendations_percent, e.site_url, e.logo_url, e.industries,
         count(v.id) filter (where not v.archived)::int as vacancy_count
  from employer e
  left join vacancy v on v.employer_id = e.id
`

export interface EmployerFilter {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export const list = (tx: Executor, filter: EmployerFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const query = filter.query?.trim() ?? ""
  const pattern = query === "" ? null : `%${query.replace(/[%_]/g, "\\$&")}%`
  const where = pattern === null ? sql`true` : sql`e.name ilike ${pattern}`

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      ${selection}
      where ${where}
      group by e.id
      order by vacancy_count desc, e.name
      limit ${limit} offset ${offset}
    `)

    const total = yield* tx.execute(sql`
      select count(*)::int as count from employer e where ${where}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<EmployerRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })
}

export const findById = (tx: Executor, id: string) =>
  tx
    .execute(sql`
      ${selection}
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
