import { Schema } from "effect"

/**
 * Market analytics: aggregates over the vacancies a preset (or the whole
 * corpus) selects. Salaries are rubles per month, taken from the middle of the
 * stated range; vacancies without a ruble salary only count in the volume
 * charts.
 */

export const MarketBucket = Schema.Struct({
  key: Schema.String,
  count: Schema.Number
})
export type MarketBucket = typeof MarketBucket.Type

export const SalaryPercentiles = Schema.Struct({
  p25: Schema.Number,
  median: Schema.Number,
  p75: Schema.Number,
  p90: Schema.Number
})
export type SalaryPercentiles = typeof SalaryPercentiles.Type

export const SalaryGroup = Schema.Struct({
  key: Schema.String,
  /** Vacancies of the group with a ruble salary. */
  n: Schema.Number,
  p25: Schema.Number,
  median: Schema.Number,
  p75: Schema.Number,
  p90: Schema.Number
})
export type SalaryGroup = typeof SalaryGroup.Type

export const SalaryHistogramBucket = Schema.Struct({
  /** Inclusive lower bound; `null` is open. */
  from: Schema.NullOr(Schema.Number),
  /** Exclusive upper bound; `null` is open. */
  to: Schema.NullOr(Schema.Number),
  count: Schema.Number
})
export type SalaryHistogramBucket = typeof SalaryHistogramBucket.Type

export const MarketTimelinePoint = Schema.Struct({
  /** ISO date of the day, `YYYY-MM-DD`. */
  date: Schema.String,
  count: Schema.Number,
  /** Of those, how many state a ruble salary. */
  withSalary: Schema.Number
})
export type MarketTimelinePoint = typeof MarketTimelinePoint.Type

/** A skill with the pay of the vacancies that mention it. */
export const SkillSalary = Schema.Struct({
  key: Schema.String,
  /** Vacancies of the selection that mention the skill. */
  count: Schema.Number,
  /** Of those, how many state a ruble salary. */
  n: Schema.Number,
  median: Schema.Number,
  p25: Schema.Number,
  p75: Schema.Number
})
export type SkillSalary = typeof SkillSalary.Type

export const MarketFlowEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  count: Schema.Number
})
export type MarketFlowEdge = typeof MarketFlowEdge.Type

export const MarketAnalytics = Schema.Struct({
  meta: Schema.Struct({
    asOf: Schema.String,
    /** Vacancies in the selection. */
    docs: Schema.Number,
    /** Vacancies in the whole corpus. */
    totalDocs: Schema.Number,
    withSalary: Schema.Number,
    /** ISO code the salaries are counted in (`RUR` is folded into `RUB`). */
    currency: Schema.String,
    /** Currencies with salaried vacancies in the selection, most frequent first. */
    currencies: Schema.Array(Schema.Struct({ code: Schema.String, count: Schema.Number })),
    publishedFrom: Schema.NullOr(Schema.String),
    publishedTo: Schema.NullOr(Schema.String)
  }),
  timeline: Schema.Array(MarketTimelinePoint),
  counts: Schema.Struct({
    seniority: Schema.Array(MarketBucket),
    workFormats: Schema.Array(MarketBucket),
    areas: Schema.Array(MarketBucket),
    companies: Schema.Array(MarketBucket)
  }),
  salaries: Schema.Struct({
    overall: Schema.NullOr(SalaryPercentiles),
    bySeniority: Schema.Array(SalaryGroup),
    histogram: Schema.Array(SalaryHistogramBucket)
  }),
  skills: Schema.Struct({
    /** Keywords found in the vacancy title or description text. */
    text: Schema.Array(SkillSalary),
    /** The "key skills" list the employer fills in on hh. */
    hh: Schema.Array(SkillSalary)
  }),
  flows: Schema.Struct({
    seniorityFormat: Schema.Array(MarketFlowEdge)
  })
})
export type MarketAnalytics = typeof MarketAnalytics.Type
