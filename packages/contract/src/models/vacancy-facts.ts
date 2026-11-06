import { Schema } from "effect"
import { ProxyConfigOrigin, ProxyRotate, ProxySource } from "../enums.ts"
import { EmployerId, VacancyId } from "../ids.ts"
import { HhVacancySignals, KeywordMatchRecord, VacancySummary } from "./corpus.ts"

/** What the employer asks to attach or tell in the response (found in the text). */
export const ApplicationRequestCode = Schema.Literals([
  "github",
  "portfolio",
  "code_samples",
  "about_me",
  "motivation"
])
export type ApplicationRequestCode = typeof ApplicationRequestCode.Type

export const ApplicationRequest = Schema.Struct({
  code: ApplicationRequestCode,
  evidence: Schema.String
})
export type ApplicationRequest = typeof ApplicationRequest.Type

export const RedFlagCode = Schema.Literals([
  "unpaid_test",
  "overtime",
  "stress",
  "multitasking",
  "work_24_7",
  "fines",
  "no_contract",
  "age_limit",
  "gender_limit",
  "night_shifts",
  "weekend_work",
  "salary_in_cash",
  "probation_unpaid",
  "job_scam"
])
export type RedFlagCode = typeof RedFlagCode.Type

export const RedFlag = Schema.Struct({
  code: RedFlagCode,
  evidence: Schema.String
})
export type RedFlag = typeof RedFlag.Type

/**
 * Working conditions the employer states in words rather than in hh fields.
 * Every field is `null` when the text says nothing; `evidence` holds the quoted
 * sentence for each fact that was found, keyed by field group.
 */
export const VacancyConditions = Schema.Struct({
  probation: Schema.NullOr(Schema.Boolean),
  probationMonths: Schema.NullOr(Schema.Int),
  probationPaid: Schema.NullOr(Schema.Boolean),
  onCall: Schema.NullOr(Schema.Boolean),
  overtime: Schema.NullOr(Schema.Literals(["none", "possible", "paid", "unpaid"])),
  businessTrips: Schema.NullOr(Schema.Literals(["none", "possible", "frequent", "percent"])),
  businessTripsPercent: Schema.NullOr(Schema.Int),
  englishLevel: Schema.NullOr(Schema.Literals(["A1", "A2", "B1", "B2", "C1", "C2"])),
  englishRequired: Schema.NullOr(Schema.Boolean),
  testTask: Schema.NullOr(Schema.Literals(["none", "possible", "paid", "unpaid"])),
  interviewStages: Schema.NullOr(Schema.Int),
  officialEmployment: Schema.NullOr(Schema.Boolean),
  citizenshipRequired: Schema.NullOr(Schema.Boolean),
  vacationDays: Schema.NullOr(Schema.Int),
  sickLeavePaid: Schema.NullOr(Schema.Boolean),
  evidence: Schema.Record(Schema.String, Schema.String)
})
export type VacancyConditions = typeof VacancyConditions.Type

/** A monthly salary stated in the description text itself. */
export const SalaryInText = Schema.Struct({
  from: Schema.NullOr(Schema.Number),
  to: Schema.NullOr(Schema.Number),
  currency: Schema.Literals(["RUB", "USD", "EUR"]),
  /** true = before tax, false = after tax, null = not said. */
  gross: Schema.NullOr(Schema.Boolean),
  evidence: Schema.String
})
export type SalaryInText = typeof SalaryInText.Type

/** Facts found by deterministic detectors in the vacancy text. */
export const VacancyTextFacts = Schema.Struct({
  coverLetter: Schema.Struct({
    /** The text asks for (or demands) a cover letter. */
    requested: Schema.Boolean,
    evidence: Schema.NullOr(Schema.String)
  }),
  applicationRequests: Schema.Array(ApplicationRequest),
  conditions: Schema.NullOr(VacancyConditions),
  redFlags: Schema.Array(RedFlag),
  salary: Schema.optional(Schema.NullOr(SalaryInText))
})
export type VacancyTextFacts = typeof VacancyTextFacts.Type

export const VacancyFacts = Schema.Struct({
  hh: Schema.NullOr(HhVacancySignals),
  text: VacancyTextFacts
})
export type VacancyFacts = typeof VacancyFacts.Type

export const VacancyDetail = Schema.Struct({
  vacancy: VacancySummary,
  descriptionText: Schema.String,
  descriptionHtml: Schema.optional(Schema.NullOr(Schema.String)),
  skills: Schema.Array(Schema.String),
  keywords: Schema.Array(KeywordMatchRecord),
  /** Cover-letter/test requirements, conditions and red flags; see `VacancyFacts`. */
  facts: Schema.optional(VacancyFacts),
  /** Responses to the vacancy as shown by hh at the last hydration. */
  responsesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
  responsesVacancy: Schema.optional(Schema.NullOr(Schema.Int))
})

export type VacancyDetail = typeof VacancyDetail.Type

/**
 * A stored vacancy that still needs its full page. The corpus keeps the search
 * card as a stub first; hydration replaces it with the vacancy page.
 */
export const HydrationTarget = Schema.Struct({
  id: VacancyId,
  source: Schema.String,
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  title: Schema.String,
  descriptionLength: Schema.Int,
  employerName: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastSeenAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type HydrationTarget = typeof HydrationTarget.Type

export const EmployerHydrationMissing = Schema.Literals(["rating", "siteUrl", "logoUrl", "industries"])
export type EmployerHydrationMissing = typeof EmployerHydrationMissing.Type

/**
 * A profile worth refreshing: only employers backing vacancies are offered,
 * oldest profile first. `missing` makes the gaps visible without opening hh.
 */
export const EmployerHydrationTarget = Schema.Struct({
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
  updatedAt: Schema.String,
  missing: Schema.Array(EmployerHydrationMissing)
})
export type EmployerHydrationTarget = typeof EmployerHydrationTarget.Type

export const HydrationStats = Schema.Struct({
  vacancyTotal: Schema.Int,
  vacancyFull: Schema.Int,
  vacancyStub: Schema.Int,
  employerTotal: Schema.Int,
  employersLinked: Schema.Int,
  employersWithoutRating: Schema.Int,
  employersWithoutSite: Schema.Int,
  employersWithoutLogo: Schema.Int,
  employersWithoutIndustries: Schema.Int,
  employersStale30Days: Schema.Int,
  /** Targets waiting out a failure backoff; not picked by the next pass. */
  deferredVacancies: Schema.Int,
  deferredEmployers: Schema.Int,
  /** Targets that failed at least five times and now retry once a day. */
  poisonedTargets: Schema.Int,
  /** Earliest moment a deferred target becomes selectable again. */
  nextRetryAt: Schema.NullOr(Schema.String)
})
export type HydrationStats = typeof HydrationStats.Type

/**
 * Local proxy state for hh requests. Contains only safe display fields: never
 * the subscription URL or credentials.
 */
/** What the local mihomo engine reports about the subscription. */
export const ProxyEngineStatus = Schema.Struct({
  reachable: Schema.Boolean,
  /** All nodes in the subscription. */
  nodes: Schema.Int,
  /** Nodes whose last health-check passed. */
  alive: Schema.Int,
  /** Nodes with a known health result (the rest are not checked yet). */
  checked: Schema.Int,
  usedBytes: Schema.NullOr(Schema.Number),
  totalBytes: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String)
})
export type ProxyEngineStatus = typeof ProxyEngineStatus.Type

export const ProxyStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: Schema.NullOr(ProxySource),
  label: Schema.String,
  origin: Schema.NullOr(ProxyConfigOrigin),
  rotate: Schema.NullOr(ProxyRotate),
  maxRotations: Schema.NullOr(Schema.Int),
  /** Subscription host only (no token path/query); null for a ready endpoint. */
  subscription: Schema.NullOr(Schema.String),
  /** Parallel workers, each with its own exit IP. */
  workers: Schema.NullOr(Schema.Int),
  /** Null for a ready endpoint or when no engine is configured. */
  engine: Schema.NullOr(ProxyEngineStatus)
})
export type ProxyStatus = typeof ProxyStatus.Type

/**
 * Write-only proxy settings from the UI. `url` is a secret: it is saved to
 * the local proxy file and never returned.
 */
export const ProxySettingsInput = Schema.Struct({
  kind: Schema.Literals(["subscription", "endpoint"]),
  /** Omit to keep the saved URL and change only rotation. */
  url: Schema.optional(Schema.String),
  rotate: Schema.optional(ProxyRotate),
  maxRotations: Schema.optional(Schema.Int),
  workers: Schema.optional(Schema.Int)
})
export type ProxySettingsInput = typeof ProxySettingsInput.Type
