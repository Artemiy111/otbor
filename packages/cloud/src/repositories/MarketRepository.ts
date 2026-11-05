import type { MarketAnalytics, PresetFilter } from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { vacancyFilterSql } from "./LexiconRepository.ts"

export interface MarketOptions {
  readonly filter?: PresetFilter
  readonly userId?: string
  readonly sinceDays?: number
  /** ISO code; `RUB` also covers the legacy `RUR`. */
  readonly currency?: string
}

/** A skill needs this many salaried vacancies to be ranked at all. */
const MIN_SKILL_SAMPLE = 3
const SKILL_LIMIT = 150

const RUB_HISTOGRAM_EDGES: ReadonlyArray<number> = [80_000, 120_000, 160_000, 200_000, 250_000, 300_000, 400_000]

const RAW_MID = `case when vacancy.salary_from is not null and vacancy.salary_to is not null
  then (vacancy.salary_from + vacancy.salary_to) / 2.0
  else coalesce(vacancy.salary_from, vacancy.salary_to)::numeric end`

/**
 * Monthly salary of a vacancy in one currency: the middle of the range, or the
 * single bound. Rubles also drop absurd values (hourly typos) so one bad row
 * cannot move a median; other currencies have no such sane range.
 */
const midSql = (currency: string): SQL => {
  const codes = currency === "RUB" ? ["RUB", "RUR"] : [currency]
  const list = sql.join(codes.map((code) => sql`${code}`), sql`, `)
  const bounds = currency === "RUB" ? sql.raw(`and (${RAW_MID}) between 15000 and 2000000`) : sql``
  return sql`case when vacancy.salary_currency in (${list})
    and coalesce(vacancy.salary_from, vacancy.salary_to) is not null ${bounds}
    then (${sql.raw(RAW_MID)}) end`
}

/** Edges for the histogram: fixed rubles, otherwise the 1/8..7/8 quantiles rounded to 2 digits. */
const roundNice = (value: number): number => {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.max(Math.floor(Math.log10(value)) - 1, 0)
  return Math.round(value / magnitude) * magnitude
}

const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value))

const percentileColumns = (alias = "mid") => sql.raw(
  `percentile_cont(0.25) within group (order by ${alias}) as p25,
   percentile_cont(0.5) within group (order by ${alias}) as median,
   percentile_cont(0.75) within group (order by ${alias}) as p75,
   percentile_cont(0.9) within group (order by ${alias}) as p90`
)

const rowsOf = <T>(result: { readonly rows: ReadonlyArray<unknown> }): ReadonlyArray<T> =>
  result.rows as unknown as ReadonlyArray<T>

export const analytics = (
  tx: Executor,
  options: MarketOptions
): RepoEffect<MarketAnalytics> =>
  Effect.gen(function*() {
    const currency = (options.currency ?? "RUB").toUpperCase().replace(/^RUR$/, "RUB")
    const filterClause: SQL = vacancyFilterSql(options.filter ?? {}, { userId: options.userId })
    const sinceDays = Math.max(0, Math.trunc(options.sinceDays ?? 0))
    const sinceClause = sinceDays > 0
      ? sql`and vacancy.published_at >= now() - make_interval(days => ${sinceDays})`
      : sql``

    // The selection is materialised once; every chart reads from it.
    yield* tx.execute(sql`
      create temp table if not exists market_sel (
        id uuid primary key, published_at timestamptz, seniority text, area text,
        employer text, work_formats jsonb, mid numeric
      ) on commit drop
    `)
    yield* tx.execute(sql`truncate market_sel`)
    yield* tx.execute(sql`
      insert into market_sel
      select vacancy.id, vacancy.published_at, vacancy.seniority, vacancy.area_name,
             (select e.name from employer e where e.id = vacancy.employer_id),
             vacancy.work_formats, ${midSql(currency)}
      from vacancy
      where ${filterClause} ${sinceClause}
    `)

    const currencyRows = yield* tx.execute(sql`
      select case when salary_currency = 'RUR' then 'RUB' else salary_currency end as code, count(*)::int as count
      from vacancy
      where coalesce(salary_from, salary_to) is not null and salary_currency is not null
        and salary_currency <> 'unknown' and vacancy.id in (select id from market_sel)
      group by 1 order by 2 desc
    `)
    const total = yield* tx.execute(sql`select count(*)::int as n from vacancy`)
    const head = yield* tx.execute(sql`
      select count(*)::int as docs, count(mid)::int as with_salary,
             min(published_at) as pub_min, max(published_at) as pub_max
      from market_sel
    `)
    const timeline = yield* tx.execute(sql`
      select to_char(date_trunc('day', published_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
             count(*)::int as count, count(mid)::int as with_salary
      from market_sel where published_at is not null
      group by 1 order by 1
    `)
    const seniority = yield* tx.execute(sql`
      select seniority as key, count(*)::int as count from market_sel group by 1 order by 2 desc
    `)
    const workFormats = yield* tx.execute(sql`
      select coalesce(f.value, 'unspecified') as key, count(*)::int as count
      from market_sel s
      left join lateral jsonb_array_elements_text(
        case when jsonb_array_length(s.work_formats) = 0 then '[null]'::jsonb else s.work_formats end
      ) as f(value) on true
      group by 1 order by 2 desc
    `)
    const areas = yield* tx.execute(sql`
      select area as key, count(*)::int as count from market_sel
      where area is not null group by 1 order by 2 desc limit 15
    `)
    const companies = yield* tx.execute(sql`
      select employer as key, count(*)::int as count from market_sel
      where employer is not null group by 1 order by 2 desc limit 15
    `)
    const overall = yield* tx.execute(sql`
      select ${percentileColumns()} from market_sel where mid is not null
    `)
    const bySeniority = yield* tx.execute(sql`
      select seniority as key, count(mid)::int as n, ${percentileColumns()}
      from market_sel where mid is not null
      group by seniority having count(mid) >= 3 order by 4
    `)
    let histogramEdges = RUB_HISTOGRAM_EDGES
    if (currency !== "RUB") {
      const quantiles = yield* tx.execute(sql`
        select ${sql.raw([1, 2, 3, 4, 5, 6, 7].map((i) => `percentile_cont(${i / 8}) within group (order by mid) as q${i}`).join(", "))}
        from market_sel where mid is not null
      `)
      const row = rowsOf<Record<string, unknown>>(quantiles)[0] ?? {}
      histogramEdges = [...new Set([1, 2, 3, 4, 5, 6, 7].map((i) => roundNice(num(row[`q${i}`]))).filter((v) => v > 0))].sort((a, b) => a - b)
    }
    const histogram = yield* tx.execute(sql`
      select width_bucket(mid, ${sql.raw(`array[${histogramEdges.length === 0 ? "1" : histogramEdges.join(",")}]::numeric[]`)}) as bucket,
             count(*)::int as count
      from market_sel where mid is not null group by 1 order by 1
    `)
    const flows = yield* tx.execute(sql`
      select s.seniority as "from", coalesce(f.value, 'unspecified') as "to", count(*)::int as count
      from market_sel s
      left join lateral jsonb_array_elements_text(
        case when jsonb_array_length(s.work_formats) = 0 then '[null]'::jsonb else s.work_formats end
      ) as f(value) on true
      group by 1, 2 order by 3 desc
    `)

    const skillRows = (location: SQL) => tx.execute(sql`
      with hit as (
        select distinct vk.vacancy_id, vk.keyword_id
        from vacancy_keyword vk join market_sel s on s.id = vk.vacancy_id
        where ${location}
      )
      select k.term as key, count(*)::int as count, count(s.mid)::int as n,
             percentile_cont(0.25) within group (order by s.mid) as p25,
             percentile_cont(0.5) within group (order by s.mid) as median,
             percentile_cont(0.75) within group (order by s.mid) as p75
      from hit join keyword k on k.id = hit.keyword_id join market_sel s on s.id = hit.vacancy_id
      where s.mid is not null
      group by k.id, k.term
      having count(s.mid) >= ${MIN_SKILL_SAMPLE}
      order by median desc
      limit ${SKILL_LIMIT}
    `)
    const textSkills = yield* skillRows(sql`(vk.in_body or vk.in_title)`)
    const hhSkills = yield* skillRows(sql`vk.in_skills`)

    const headRow = rowsOf<{ docs: number; with_salary: number; pub_min: Date | string | null; pub_max: Date | string | null }>(head)[0]
    const iso = (value: Date | string | null | undefined): string | null =>
      value === null || value === undefined ? null : new Date(value).toISOString()

    const overallRow = rowsOf<Record<string, unknown>>(overall)[0]
    const hasOverall = overallRow !== undefined && overallRow.median !== null

    const bucket = (row: { readonly key: string; readonly count: number }) => ({ key: row.key, count: num(row.count) })
    const skill = (row: Record<string, unknown>) => ({
      key: String(row.key),
      count: num(row.count),
      n: num(row.n),
      p25: Math.round(num(row.p25)),
      median: Math.round(num(row.median)),
      p75: Math.round(num(row.p75))
    })

    const counts = new Map<number, number>()
    for (const row of rowsOf<{ bucket: number; count: number }>(histogram)) counts.set(num(row.bucket), num(row.count))
    const edges = [null, ...(histogramEdges.length === 0 ? [1] : histogramEdges), null]
    const histogramBuckets = edges.slice(0, -1).map((from, index) => ({
      from,
      to: edges[index + 1] ?? null,
      count: counts.get(index) ?? 0
    }))

    return {
      meta: {
        asOf: new Date().toISOString(),
        docs: num(headRow?.docs),
        totalDocs: num(rowsOf<{ n: number }>(total)[0]?.n),
        withSalary: num(headRow?.with_salary),
        currency,
        currencies: rowsOf<{ code: string; count: number }>(currencyRows).map((row) => ({ code: row.code, count: num(row.count) })),
        publishedFrom: iso(headRow?.pub_min),
        publishedTo: iso(headRow?.pub_max)
      },
      timeline: rowsOf<{ date: string; count: number; with_salary: number }>(timeline).map((row) => ({
        date: row.date,
        count: num(row.count),
        withSalary: num(row.with_salary)
      })),
      counts: {
        seniority: rowsOf<{ key: string; count: number }>(seniority).map(bucket),
        workFormats: rowsOf<{ key: string; count: number }>(workFormats).map(bucket),
        areas: rowsOf<{ key: string; count: number }>(areas).map(bucket),
        companies: rowsOf<{ key: string; count: number }>(companies).map(bucket)
      },
      salaries: {
        overall: hasOverall
          ? {
              p25: Math.round(num(overallRow.p25)),
              median: Math.round(num(overallRow.median)),
              p75: Math.round(num(overallRow.p75)),
              p90: Math.round(num(overallRow.p90))
            }
          : null,
        bySeniority: rowsOf<Record<string, unknown>>(bySeniority).map((row) => ({
          key: String(row.key),
          n: num(row.n),
          p25: Math.round(num(row.p25)),
          median: Math.round(num(row.median)),
          p75: Math.round(num(row.p75)),
          p90: Math.round(num(row.p90))
        })),
        histogram: histogramBuckets
      },
      skills: {
        text: rowsOf<Record<string, unknown>>(textSkills).map(skill),
        hh: rowsOf<Record<string, unknown>>(hhSkills).map(skill)
      },
      flows: {
        seniorityFormat: rowsOf<{ from: string; to: string; count: number }>(flows).map((row) => ({
          from: row.from,
          to: row.to,
          count: num(row.count)
        }))
      }
    }
  })
