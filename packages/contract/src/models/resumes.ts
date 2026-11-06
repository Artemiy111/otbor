import { Schema } from "effect"
import { HhAccountId, ResumeId } from "../ids.ts"

export const ResumeExperienceEnrichment = Schema.Struct({
  key: Schema.String,
  employmentType: Schema.optional(Schema.NullOr(Schema.String)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
  leaveReason: Schema.optional(Schema.NullOr(Schema.String))
})

export type ResumeExperienceEnrichment = typeof ResumeExperienceEnrichment.Type

/** Currencies the operator can state a salary in. One slot per currency, never free text. */
export const SALARY_CURRENCIES = ["RUB", "USD", "EUR", "KZT", "BYN"] as const

export const SalaryCurrency = Schema.Literals(SALARY_CURRENCIES)

export type SalaryCurrency = typeof SalaryCurrency.Type

/** The minimum and the expected salary in one currency; a missing amount is null. */
export const ResumeSalary = Schema.Struct({
  currency: SalaryCurrency,
  min: Schema.NullOr(Schema.Int),
  expectation: Schema.NullOr(Schema.Int)
})

export type ResumeSalary = typeof ResumeSalary.Type

/**
 * Questions that come up in hh response forms again and again. The operator
 * writes how to answer each one; the text is a hint for the agent, not a
 * final answer. A key outside this list is a custom question with its own text.
 */
export const RESUME_FAQ_TOPICS = [
  { key: "city", question: "В каком городе вы живёте?", short: true },
  { key: "relocation", question: "Готовы ли вы к переезду?", short: true },
  { key: "office", question: "Готовы ли вы работать в офисе или в гибридном формате?", short: true },
  { key: "business_trips", question: "Готовы ли вы к командировкам?", short: true },
  { key: "employment_type", question: "Какое оформление вам подходит (ТК, ИП, самозанятость)?", short: true },
  { key: "notice_period", question: "Когда вы готовы выйти на работу?", short: true },
  { key: "english_level", question: "Какой у вас уровень английского?", short: true },
  { key: "previous_work_format", question: "В каком формате вы работали на прошлом месте?" },
  { key: "leave_reason", question: "Почему вы уходите с текущего или ушли с прошлого места?" },
  { key: "schedule", question: "Подходит ли вам график 2/2 или сменная работа?", short: true }
] as const

export const ResumeFaqEntry = Schema.Struct({
  key: Schema.String,
  /** Only for custom entries; a known topic takes its question from RESUME_FAQ_TOPICS. */
  question: Schema.optional(Schema.NullOr(Schema.String)),
  answer: Schema.String
})

export type ResumeFaqEntry = typeof ResumeFaqEntry.Type

export const ResumeEnrichment = Schema.Struct({
  resumeId: ResumeId,
  /** Notes for the agent about the whole resume. */
  comment: Schema.String,
  /** Filled currencies only. The first one is the primary salary. */
  salaries: Schema.Array(ResumeSalary),
  /** The primary salary, derived from `salaries`; kept for readers that want one number. */
  salaryMin: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryExpectation: Schema.optional(Schema.NullOr(Schema.Int)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  faq: Schema.Array(ResumeFaqEntry),
  experience: Schema.Array(ResumeExperienceEnrichment),
  /**
   * The operator's word on whether they work right now. `null` or missing means
   * "work it out from the resume": the last job has no end date.
   */
  currentlyEmployed: Schema.optional(Schema.NullOr(Schema.Boolean)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type ResumeEnrichment = typeof ResumeEnrichment.Type

export const ResumeRecord = Schema.Struct({
  id: ResumeId,
  hhAccountId: HhAccountId,
  source: Schema.String,
  externalId: Schema.String,
  title: Schema.String,
  text: Schema.String,
  about: Schema.String,
  skills: Schema.Array(Schema.String),
  experience: Schema.Array(Schema.Unknown),
  education: Schema.Unknown,
  workFormats: Schema.Array(Schema.String),
  salaryAmount: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  /** The city, relocation, business trips and commute as hh states them in the resume. */
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  relocation: Schema.optional(Schema.NullOr(Schema.String)),
  businessTripReadiness: Schema.optional(Schema.NullOr(Schema.String)),
  travelTime: Schema.optional(Schema.NullOr(Schema.String)),
  englishLevel: Schema.optional(Schema.NullOr(Schema.String)),
  isActive: Schema.Boolean,
  lastSeenAt: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ResumeRecord = typeof ResumeRecord.Type

export const ResumeDraft = Schema.Struct({
  hhAccountId: HhAccountId,
  source: Schema.optional(Schema.String),
  externalId: Schema.String,
  title: Schema.String,
  text: Schema.String,
  about: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String)),
  experience: Schema.optional(Schema.Unknown),
  education: Schema.optional(Schema.Unknown),
  workFormats: Schema.optional(Schema.Array(Schema.String)),
  salaryAmount: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  relocation: Schema.optional(Schema.NullOr(Schema.String)),
  businessTripReadiness: Schema.optional(Schema.NullOr(Schema.String)),
  travelTime: Schema.optional(Schema.NullOr(Schema.String)),
  englishLevel: Schema.optional(Schema.NullOr(Schema.String)),
  isActive: Schema.optional(Schema.Boolean),
  lastSeenAt: Schema.optional(Schema.String)
})

export type ResumeDraft = typeof ResumeDraft.Type
