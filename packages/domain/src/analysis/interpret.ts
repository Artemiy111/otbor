import { Schema } from "effect"
import type { VacancyAnalysisFacts } from "@otbor/contract"

/**
 * Raw answers exactly as the model server returns them, plus the rules that
 * turn them into typed facts. Accuracy depends on the model's confidence
 * (about 92% above 0.8, about 40% below), so every fact keeps its confidence
 * and anything under the threshold reads as unknown (`null`).
 */

export const RawNoulAnswer = Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number })
export const RawChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  confidence: Schema.Number,
  probabilities: Schema.optional(Schema.Record(Schema.String, Schema.Number))
})
export const RawScoreAnswer = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  confidence: Schema.Number
})
export const RawAnswer = Schema.Union([RawNoulAnswer, RawChoiceAnswer, RawScoreAnswer])
export type RawAnswer = typeof RawAnswer.Type

/** The `answers` object of a `/v1/systemone` response, keyed by question id. */
export const RawAnswers = Schema.Record(Schema.String, RawAnswer)
export type RawAnswers = typeof RawAnswers.Type

export interface InterpretOptions {
  readonly threshold: number
  /**
   * hh `employer.category`. `agency` is a recruiter whatever the model says:
   * the employer profile is more reliable than a guess from its text.
   */
  readonly employerCategory?: string | null
}

type Fact<A> = { readonly value: A; readonly confidence: number } | null

/** `1 - 0.8` is not exactly `0.2`; the boundaries are meant to be inclusive. */
const EPSILON = 1e-9

const round = (value: number): number => Math.round(value * 1000) / 1000

const yesNo =
  (raw: RawAnswers, id: string, threshold: number) =>
  (): Fact<boolean> => {
    const answer = raw[id]
    if (answer === undefined || answer.type !== "noul") return null
    const p = answer.noul
    if (p >= threshold - EPSILON) return { value: true, confidence: round(p) }
    if (p <= 1 - threshold + EPSILON) return { value: false, confidence: round(1 - p) }
    return null
  }

/**
 * Top option when its confidence reaches the threshold. Options the schema
 * does not know, and the explicit `unknown` option, read as unknown.
 */
const pick = <A extends string>(
  raw: RawAnswers,
  id: string,
  threshold: number,
  options: ReadonlyArray<A>
): Fact<A> => {
  const answer = raw[id]
  if (answer === undefined || answer.type !== "choice") return null
  if (answer.confidence < threshold - EPSILON) return null
  const value = options.find((option) => option === answer.choice)
  return value === undefined ? null : { value, confidence: round(answer.confidence) }
}

const score = (raw: RawAnswers, id: string): Fact<number> => {
  const answer = raw[id]
  if (answer === undefined || answer.type !== "score") return null
  return { value: round(answer.score), confidence: round(answer.confidence) }
}

const ROLES = [
  "devops", "sre", "platform", "sysadmin", "security", "backend", "frontend", "fullstack",
  "mobile", "qa", "data", "analyst", "dba", "support", "manager", "other"
] as const
const LEVELS = ["intern", "junior", "middle", "senior", "staff", "tech_lead", "team_lead", "head"] as const
const COMPANY_TYPES = [
  "product", "outsource", "outstaff", "integrator", "consulting", "bank_fintech", "government",
  "startup", "recruiter"
] as const
const REQUESTS = ["required", "preferred", "not_mentioned"] as const

export const interpretAnswers = (raw: RawAnswers, options: InterpretOptions): VacancyAnalysisFacts => {
  const t = options.threshold
  const bool = (id: string) => yesNo(raw, id, t)()
  const choice = <A extends string>(id: string, values: ReadonlyArray<A>) => pick(raw, id, t, values)
  const companyType: Fact<(typeof COMPANY_TYPES)[number]> =
    options.employerCategory === "agency"
      ? { value: "recruiter", confidence: 1 }
      : choice("company_type", COMPANY_TYPES)

  return {
    isIt: bool("is_it_role"),
    role: choice("role", ROLES),
    titleLevel: choice("title_level", LEVELS),
    requiredLevel: choice("required_level", LEVELS),
    yearsMin: score(raw, "years_min"),
    managesPeople: bool("manages_people"),
    companyType,
    workMode: choice("work_mode", ["remote", "hybrid", "office", "unspecified"]),
    employment: choice("employment", ["labor_code", "contractor", "unspecified"]),
    locationRequirement: choice("location_requirement", [
      "any", "city_or_country", "relocation_help", "unspecified"
    ]),
    internship: choice("internship", ["not_internship", "paid", "unpaid", "unspecified"]),
    coverLetter: choice("req_cover_letter", REQUESTS),
    repo: choice("req_repo", REQUESTS),
    portfolio: choice("req_portfolio", REQUESTS),
    answersInReply: choice("req_answers_in_reply", REQUESTS),
    contactOutside: choice("req_contact_outside", REQUESTS),
    externalForm: choice("req_external_form", REQUESTS),
    salaryExpectation: choice("req_salary_expectation", REQUESTS),
    testTask: choice("test_task", ["none", "paid", "unpaid", "unspecified"]),
    english: choice("english", REQUESTS),
    onCall: bool("on_call"),
    nightOrWeekend: bool("night_or_weekend"),
    overtime: bool("overtime"),
    businessTrips: bool("business_trips"),
    probation: bool("probation"),
    probationUnpaidOrReduced: bool("probation_unpaid_or_reduced"),
    salaryInText: bool("salary_in_text"),
    bonus: bool("bonus"),
    healthInsurance: bool("health_insurance"),
    educationBudget: bool("education_budget"),
    soloRole: bool("solo_role"),
    relocationRequired: bool("relocation_required"),
    citizenshipRequired: bool("citizenship_required"),
    redFlags: {
      stress: bool("redflag_stress"),
      multitask: bool("redflag_multitask"),
      scam: bool("redflag_scam"),
      discrimination: bool("redflag_discrimination")
    }
  }
}
