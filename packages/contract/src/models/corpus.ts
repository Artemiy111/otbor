import { Schema } from "effect"
import { BlacklistScope, BlacklistSource, BlacklistTarget, Seniority } from "../enums.ts"
import {
  BlacklistId,
  EmployerId,
  HhAccountId,
  KeywordAliasId,
  KeywordId,
  VacancyId
} from "../ids.ts"

export const EmployerDraft = Schema.Struct({
  externalId: Schema.String,
  name: Schema.String,
  rating: Schema.optional(Schema.NullOr(Schema.Number)),
  reviewsCount: Schema.optional(Schema.NullOr(Schema.Int)),
  recommendationsPercent: Schema.optional(Schema.NullOr(Schema.Int)),
  siteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  industries: Schema.optional(Schema.Array(Schema.String))
})

export type EmployerDraft = typeof EmployerDraft.Type

export const SalaryDraft = Schema.Struct({
  from: Schema.optional(Schema.NullOr(Schema.Int)),
  to: Schema.optional(Schema.NullOr(Schema.Int)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  gross: Schema.optional(Schema.NullOr(Schema.Boolean)),
  negotiable: Schema.optional(Schema.Boolean)
})

export type SalaryDraft = typeof SalaryDraft.Type

/**
 * What hh itself says about applying, captured once from the vacancy page
 * (`vacancy.signals.hh`). `null` on the detail means "never captured": the
 * vacancy was hydrated before these fields were read.
 */
export const HhVacancySignals = Schema.Struct({
  capturedAt: Schema.String,
  /** hh makes the cover letter mandatory in the response form. */
  letterRequired: Schema.NullOr(Schema.Boolean),
  /** An employer test/questionnaire is shown before the response. */
  test: Schema.Struct({
    hasTest: Schema.Boolean,
    required: Schema.NullOr(Schema.Boolean)
  }),
  validUntil: Schema.NullOr(Schema.String),
  workScheduleDays: Schema.Array(Schema.String),
  workingHours: Schema.Array(Schema.String)
})

export type HhVacancySignals = typeof HhVacancySignals.Type

/**
 * A normalized vacancy coming from an adapter (HTTP page, HTML file, browser
 * extension). Everything below the boundary is typed; `raw` keeps the original
 * payload for re-parsing when the adapter improves.
 */
export const VacancyDraft = Schema.Struct({
  source: Schema.optional(Schema.String),
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  url: Schema.optional(Schema.String),
  title: Schema.String,
  employer: Schema.optional(Schema.NullOr(EmployerDraft)),
  areaId: Schema.optional(Schema.NullOr(Schema.Int)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  salary: Schema.optional(Schema.NullOr(SalaryDraft)),
  experienceCode: Schema.optional(Schema.NullOr(Schema.String)),
  employmentForm: Schema.optional(Schema.NullOr(Schema.String)),
  workFormats: Schema.optional(Schema.Array(Schema.String)),
  seniority: Schema.optional(Seniority),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.Boolean),
  descriptionHtml: Schema.optional(Schema.NullOr(Schema.String)),
  descriptionText: Schema.optional(Schema.NullOr(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  responsesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
  responsesVacancy: Schema.optional(Schema.NullOr(Schema.Int)),
  /** What hh says about applying; stored in `vacancy.signals.hh`. */
  hhSignals: Schema.optional(HhVacancySignals),
  raw: Schema.optional(Schema.Unknown)
})

export type VacancyDraft = typeof VacancyDraft.Type

export const VacancySummary = Schema.Struct({
  id: VacancyId,
  source: Schema.String,
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  title: Schema.String,
  employerId: Schema.optional(Schema.NullOr(EmployerId)),
  employerName: Schema.optional(Schema.NullOr(Schema.String)),
  employerRating: Schema.optional(Schema.NullOr(Schema.Number)),
  employerLogoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  salaryFrom: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryTo: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  seniority: Seniority,
  experienceCode: Schema.optional(Schema.NullOr(Schema.String)),
  employmentForm: Schema.optional(Schema.NullOr(Schema.String)),
  workFormats: Schema.Array(Schema.String),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.Boolean,
  createdAt: Schema.String,
  lastSeenAt: Schema.String,
  /** A label, not a ban: the row is still in the corpus and can be shown. */
  blacklisted: Schema.Boolean,
  /** Which layers matched: app, the selected hh account, or hh native hiding. */
  blacklistLayers: Schema.Array(BlacklistScope),
  /** A vacancy analysis exists for the current analysis prompt version. */
  analysed: Schema.optional(Schema.Boolean),
  /** Responses as shown by hh at the last hydration: all vacancies of the employer's group / this vacancy. */
  responsesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
  responsesVacancy: Schema.optional(Schema.NullOr(Schema.Int)),
  /** hh signals (`signals.hh`); null until the vacancy page was read. */
  letterRequired: Schema.optional(Schema.NullOr(Schema.Boolean)),
  hasTest: Schema.optional(Schema.NullOr(Schema.Boolean)),
  testRequired: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Role the AI analysis assigned (`facts.role`), absent without a current analysis. */
  analysisRole: Schema.optional(Schema.NullOr(Schema.String)),
  /** Minimum years of experience the AI analysis read from the text (`facts.yearsMin`). */
  analysisYearsMin: Schema.optional(Schema.NullOr(Schema.Number)),
  /** First characters of the description, for the listing card. */
  snippet: Schema.optional(Schema.NullOr(Schema.String)),
  /** Accounts with an active response to this vacancy, each with the resumes it used. */
  responded: Schema.optional(
    Schema.Array(
      Schema.Struct({
        accountId: Schema.String,
        resumeIds: Schema.Array(Schema.NullOr(Schema.String))
      })
    )
  )
})

export type VacancySummary = typeof VacancySummary.Type

export const EmployerSummary = Schema.Struct({
  id: EmployerId,
  source: Schema.String,
  externalId: Schema.String,
  name: Schema.String,
  rating: Schema.optional(Schema.NullOr(Schema.Number)),
  reviewsCount: Schema.optional(Schema.NullOr(Schema.Int)),
  recommendationsPercent: Schema.optional(Schema.NullOr(Schema.Int)),
  siteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  industries: Schema.Array(Schema.String),
  vacancyCount: Schema.Int,
  /** hh accounts that responded to at least one vacancy of this employer. */
  respondedAccountIds: Schema.optional(Schema.Array(HhAccountId)),
  blacklisted: Schema.Boolean,
  blacklistLayers: Schema.Array(BlacklistScope),
  /** hh accounts that blocked this employer on their own (account or native layer). */
  blockedAccountIds: Schema.optional(Schema.Array(HhAccountId))
})

export type EmployerSummary = typeof EmployerSummary.Type

export const EmployerBadge = Schema.Struct({
  type: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  year: Schema.NullOr(Schema.Number)
})
export type EmployerBadge = typeof EmployerBadge.Type

/** What hh's `/employer/{id}` page says about the company. Null fields were not on the page. */
export const EmployerProfile = Schema.Struct({
  category: Schema.NullOr(Schema.String),
  sizeCategory: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  siteHost: Schema.NullOr(Schema.String),
  descriptionText: Schema.NullOr(Schema.String),
  badges: Schema.Array(EmployerBadge),
  trusted: Schema.NullOr(Schema.Boolean),
  accreditedIt: Schema.NullOr(Schema.Boolean),
  activeVacancies: Schema.NullOr(Schema.Int),
  /** Null until the employer page has been hydrated at least once. */
  fetchedAt: Schema.NullOr(Schema.String)
})
export type EmployerProfile = typeof EmployerProfile.Type

export const EmployerDetail = Schema.Struct({
  employer: EmployerSummary,
  /** Absent for employers that were never hydrated from their page. */
  profile: Schema.optional(Schema.NullOr(EmployerProfile)),
  vacancies: Schema.Array(VacancySummary)
})

export type EmployerDetail = typeof EmployerDetail.Type

/**
 * One blacklist row. `scope = app` has no account; account and native rows do.
 * The record is a visibility filter and a label — it never removes a vacancy
 * or an employer from the corpus.
 */
export const BlacklistRecord = Schema.Struct({
  id: BlacklistId,
  scope: BlacklistScope,
  hhAccountId: Schema.optional(Schema.NullOr(HhAccountId)),
  targetType: BlacklistTarget,
  externalId: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  source: BlacklistSource,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastSeenAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type BlacklistRecord = typeof BlacklistRecord.Type

export const KeywordMatchRecord = Schema.Struct({
  keywordId: KeywordId,
  term: Schema.String,
  aliasId: Schema.optional(Schema.NullOr(KeywordAliasId)),
  matchedForm: Schema.String,
  typo: Schema.Boolean,
  inTitle: Schema.Boolean,
  titleCount: Schema.Int,
  inBody: Schema.Boolean,
  bodyCount: Schema.Int,
  inSkills: Schema.Boolean
})

export type KeywordMatchRecord = typeof KeywordMatchRecord.Type
