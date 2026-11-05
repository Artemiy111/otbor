import { Schema } from "effect"
import { VacancyId } from "./ids.ts"

/**
 * Layer A of the vacancy analysis: facts about the vacancy itself, extracted by
 * the local decision model and independent of any user. Every fact carries the
 * model's confidence; below the threshold a fact reads as `null` (unknown).
 */

const Unit = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))

/** One fact: the value and how sure the model was. `null` means unknown. */
const fact = <S extends Schema.Top>(value: S) =>
  Schema.NullOr(Schema.Struct({ value, confidence: Unit }))

export const AnalysisRole = Schema.Literals([
  "devops",
  "sre",
  "platform",
  "sysadmin",
  "security",
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "qa",
  "data",
  "analyst",
  "dba",
  "support",
  "manager",
  "other"
])
export type AnalysisRole = typeof AnalysisRole.Type

/** `unknown` ("level is not stated") is stored as a `null` fact. */
export const AnalysisLevel = Schema.Literals([
  "intern",
  "junior",
  "middle",
  "senior",
  "staff",
  "tech_lead",
  "team_lead",
  "head"
])
export type AnalysisLevel = typeof AnalysisLevel.Type

/** `unknown` ("cannot tell from the text") is stored as a `null` fact. */
export const AnalysisCompanyType = Schema.Literals([
  "product",
  "outsource",
  "outstaff",
  "integrator",
  "consulting",
  "bank_fintech",
  "government",
  "startup",
  "recruiter"
])
export type AnalysisCompanyType = typeof AnalysisCompanyType.Type

export const AnalysisWorkMode = Schema.Literals(["remote", "hybrid", "office", "unspecified"])
export const AnalysisEmployment = Schema.Literals(["labor_code", "contractor", "unspecified"])
export const AnalysisLocation = Schema.Literals(["any", "city_or_country", "relocation_help", "unspecified"])
export const AnalysisInternship = Schema.Literals(["not_internship", "paid", "unpaid", "unspecified"])
export const AnalysisRequest = Schema.Literals(["required", "preferred", "not_mentioned"])
export type AnalysisRequest = typeof AnalysisRequest.Type
export const AnalysisTestTask = Schema.Literals(["none", "paid", "unpaid", "unspecified"])
export type AnalysisTestTask = typeof AnalysisTestTask.Type

export const VacancyAnalysisFacts = Schema.Struct({
  isIt: fact(Schema.Boolean),
  role: fact(AnalysisRole),
  titleLevel: fact(AnalysisLevel),
  requiredLevel: fact(AnalysisLevel),
  /** 0..6, the score is kept as the model gave it. */
  yearsMin: fact(Schema.Number),
  managesPeople: fact(Schema.Boolean),
  companyType: fact(AnalysisCompanyType),
  workMode: fact(AnalysisWorkMode),
  employment: fact(AnalysisEmployment),
  locationRequirement: fact(AnalysisLocation),
  internship: fact(AnalysisInternship),
  coverLetter: fact(AnalysisRequest),
  repo: fact(AnalysisRequest),
  portfolio: fact(AnalysisRequest),
  answersInReply: fact(AnalysisRequest),
  contactOutside: fact(AnalysisRequest),
  externalForm: fact(AnalysisRequest),
  salaryExpectation: fact(AnalysisRequest),
  testTask: fact(AnalysisTestTask),
  english: fact(AnalysisRequest),
  onCall: fact(Schema.Boolean),
  nightOrWeekend: fact(Schema.Boolean),
  overtime: fact(Schema.Boolean),
  businessTrips: fact(Schema.Boolean),
  probation: fact(Schema.Boolean),
  probationUnpaidOrReduced: fact(Schema.Boolean),
  salaryInText: fact(Schema.Boolean),
  bonus: fact(Schema.Boolean),
  healthInsurance: fact(Schema.Boolean),
  educationBudget: fact(Schema.Boolean),
  soloRole: fact(Schema.Boolean),
  relocationRequired: fact(Schema.Boolean),
  citizenshipRequired: fact(Schema.Boolean),
  redFlags: Schema.Struct({
    stress: fact(Schema.Boolean),
    multitask: fact(Schema.Boolean),
    scam: fact(Schema.Boolean),
    discrimination: fact(Schema.Boolean)
  })
})
export type VacancyAnalysisFacts = typeof VacancyAnalysisFacts.Type

/** The stored analysis of one vacancy under one prompt version. */
export const VacancyAnalysis = Schema.Struct({
  vacancyId: VacancyId,
  promptVersion: Schema.String,
  inputHash: Schema.String,
  model: Schema.String,
  /** The confidence threshold `facts` were interpreted at. */
  threshold: Unit,
  facts: VacancyAnalysisFacts,
  latencyMs: Schema.NullOr(Schema.Int),
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type VacancyAnalysis = typeof VacancyAnalysis.Type

/** One bounded analysis pass triggered by hand (`otbor analysis run`). */
export const AnalysisRunInput = Schema.Struct({
  limit: Schema.optional(Schema.Int),
  delayMs: Schema.optional(Schema.Int)
})
export type AnalysisRunInput = typeof AnalysisRunInput.Type

export const AnalysisRunResult = Schema.Struct({
  processed: Schema.Int,
  analysed: Schema.Int,
  skipped: Schema.Int,
  failed: Schema.Int,
  errors: Schema.Array(Schema.String),
  /** Set when the model server was down or rejected the key and the pass ended early. */
  stoppedBy: Schema.NullOr(Schema.Literals(["unreachable", "unauthorized"]))
})
export type AnalysisRunResult = typeof AnalysisRunResult.Type

export const AnalysisStats = Schema.Struct({
  promptVersion: Schema.String,
  /** Fully hydrated vacancies. */
  total: Schema.Int,
  /** Of those, with a stored analysis for the prompt version. */
  analysed: Schema.Int
})
export type AnalysisStats = typeof AnalysisStats.Type

const LatencySummary = Schema.Struct({
  count: Schema.Int,
  avgMs: Schema.NullOr(Schema.Int),
  p50Ms: Schema.NullOr(Schema.Int),
  p95Ms: Schema.NullOr(Schema.Int),
  maxMs: Schema.NullOr(Schema.Int)
})

/** What the model's work looked like over a period: speed, volume, models, slow cases, recent passes. */
export const AnalysisInsights = Schema.Struct({
  promptVersion: Schema.String,
  days: Schema.Int,
  total: Schema.Int,
  analysed: Schema.Int,
  latency: LatencySummary,
  byDay: Schema.Array(
    Schema.Struct({ day: Schema.String, count: Schema.Int, avgMs: Schema.NullOr(Schema.Int) })
  ),
  byModel: Schema.Array(Schema.Struct({ model: Schema.String, ...LatencySummary.fields })),
  slowest: Schema.Array(
    Schema.Struct({
      vacancyId: VacancyId,
      title: Schema.String,
      model: Schema.String,
      latencyMs: Schema.Int,
      at: Schema.String
    })
  ),
  runs: Schema.Array(
    Schema.Struct({
      startedAt: Schema.String,
      seconds: Schema.Int,
      analysed: Schema.Int,
      skipped: Schema.Int,
      failed: Schema.Int,
      status: Schema.String,
      stoppedBy: Schema.NullOr(Schema.String)
    })
  )
})
export type AnalysisInsights = typeof AnalysisInsights.Type
