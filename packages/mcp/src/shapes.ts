import type {
  ApplicationRecord,
  DecisionRecord,
  EmployerSummary,
  VacancySummary
} from "@otbor/contract"
import { Schema } from "effect"

/**
 * Compact, LLM-facing shapes. They deliberately drop user ids, timestamps that
 * do not matter for a decision, raw HTML and blacklist plumbing. Every tool
 * returns one of these, never a raw contract record.
 */

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)

export const clamp = (value: number | undefined, fallback: number, max: number, min = 1): number =>
  Math.min(Math.max(Math.trunc(value ?? fallback), min), max)

export const truncate = (text: string, maxChars: number): { readonly text: string; readonly truncated: boolean } =>
  text.length <= maxChars ? { text, truncated: false } : { text: `${text.slice(0, maxChars)}…`, truncated: true }

export const formatSalary = (
  from: number | null | undefined,
  to: number | null | undefined,
  currency: string | null | undefined
): string | null => {
  if (from == null && to == null) return null
  const range = from != null && to != null ? `${from}-${to}` : from != null ? `from ${from}` : `up to ${to}`
  return currency ? `${range} ${currency}` : range
}

/** `code: detail (weight)` strongest first, so "top reasons" is just a slice. */
export const humanReasons = (
  reasons: DecisionRecord["reasons"],
  top: number
): ReadonlyArray<string> =>
  [...reasons]
    .sort((a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0))
    .slice(0, top)
    .map((r) =>
      `${r.code.replaceAll("_", " ")}${r.detail ? `: ${r.detail}` : ""}${r.weight === undefined ? "" : ` (${r.weight})`}`
    )

/* ---------------------------------- vacancy -------------------------------- */

export const VacancyBrief = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  employer: NullableString,
  employerId: NullableString,
  area: NullableString,
  salary: NullableString,
  workFormats: Schema.Array(Schema.String),
  seniority: Schema.String,
  publishedAt: NullableString,
  archived: Schema.Boolean,
  blacklisted: Schema.Boolean,
  url: Schema.String
})
export type VacancyBrief = typeof VacancyBrief.Type

export const vacancyBrief = (v: VacancySummary): VacancyBrief => ({
  id: v.id,
  title: v.title,
  employer: v.employerName ?? null,
  employerId: v.employerId ?? null,
  area: v.areaName ?? null,
  salary: formatSalary(v.salaryFrom, v.salaryTo, v.salaryCurrency),
  workFormats: v.workFormats,
  seniority: v.seniority,
  publishedAt: v.publishedAt ?? null,
  archived: v.archived,
  blacklisted: v.blacklisted,
  url: v.canonicalUrl
})

/* --------------------------------- decision -------------------------------- */

export const DecisionBrief = Schema.Struct({
  decisionId: Schema.String,
  vacancyId: Schema.String,
  title: NullableString,
  verdict: Schema.String,
  gate: Schema.String,
  fit: Schema.Number,
  priority: Schema.Number,
  roleFamily: NullableString,
  reasons: Schema.Array(Schema.String),
  decidedAt: Schema.String
})
export type DecisionBrief = typeof DecisionBrief.Type

export const decisionBrief = (d: DecisionRecord, topReasons = 5): DecisionBrief => ({
  decisionId: d.id,
  vacancyId: d.vacancyId,
  title: d.vacancyTitle ?? null,
  verdict: d.verdict,
  gate: d.gate,
  fit: d.fit,
  priority: d.priority,
  roleFamily: d.roleFamily,
  reasons: humanReasons(d.reasons, topReasons),
  decidedAt: d.createdAt
})

/* -------------------------------- application ------------------------------ */

export const ApplicationBrief = Schema.Struct({
  id: Schema.String,
  vacancyId: Schema.String,
  title: NullableString,
  employer: NullableString,
  state: Schema.String,
  decisionId: NullableString,
  resumeId: NullableString,
  updatedAt: Schema.String
})
export type ApplicationBrief = typeof ApplicationBrief.Type

export const applicationBrief = (a: ApplicationRecord): ApplicationBrief => ({
  id: a.id,
  vacancyId: a.vacancyId,
  title: a.vacancyTitle ?? null,
  employer: a.employerName ?? null,
  state: a.state,
  decisionId: a.decisionId ?? null,
  resumeId: a.resumeId ?? null,
  updatedAt: a.updatedAt
})

/* --------------------------------- employer -------------------------------- */

export const EmployerBrief = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rating: NullableNumber,
  reviews: Schema.NullOr(Schema.Int),
  recommendationsPercent: Schema.NullOr(Schema.Int),
  industries: Schema.Array(Schema.String),
  vacancyCount: Schema.Int,
  blacklisted: Schema.Boolean,
  siteUrl: NullableString
})
export type EmployerBrief = typeof EmployerBrief.Type

export const employerBrief = (e: EmployerSummary): EmployerBrief => ({
  id: e.id,
  name: e.name,
  rating: e.rating ?? null,
  reviews: e.reviewsCount ?? null,
  recommendationsPercent: e.recommendationsPercent ?? null,
  industries: e.industries,
  vacancyCount: e.vacancyCount,
  blacklisted: e.blacklisted,
  siteUrl: e.siteUrl ?? null
})
