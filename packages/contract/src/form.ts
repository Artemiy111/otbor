import { Schema } from "effect"

/**
 * The hh.ru response form ("employer test"): the questions an employer asks
 * before an application is accepted, and the answers we plan to give.
 *
 * Browser-safe: schemas only. Parsing lives in `@otbor/hh`, hints and
 * validation in `@otbor/domain`.
 */

export const FormQuestionKind = Schema.Literals(["single", "multiple", "text", "code"])

export type FormQuestionKind = typeof FormQuestionKind.Type

export const FormOption = Schema.Struct({
  /** hh option id: the `value` of the radio/checkbox input. */
  id: Schema.String,
  label: Schema.String
})

export type FormOption = typeof FormOption.Type

export const FormQuestion = Schema.Struct({
  /** hh task id, the digits of `task_<id>`. */
  id: Schema.String,
  kind: FormQuestionKind,
  text: Schema.String,
  options: Schema.Array(FormOption),
  required: Schema.Boolean,
  maxLength: Schema.optional(Schema.NullOr(Schema.Int)),
  codeLanguage: Schema.optional(Schema.NullOr(Schema.String))
})

export type FormQuestion = typeof FormQuestion.Type

/**
 * `known`: the markup matched the documented selectors, so an empty question
 * list really means "no questions". `unknown`: the layout was not recognized,
 * which must never be read as "no questions".
 */
export const FormLayout = Schema.Literals(["known", "unknown"])

export type FormLayout = typeof FormLayout.Type

export const CoverLetterRequirement = Schema.Literals(["required", "optional", "absent"])

export type CoverLetterRequirement = typeof CoverLetterRequirement.Type

export const ResponseForm = Schema.Struct({
  /** hh external vacancy id. */
  vacancyId: Schema.String,
  layout: FormLayout,
  questions: Schema.Array(FormQuestion),
  coverLetter: CoverLetterRequirement,
  /** Stable hash over the normalized questions and options, in page order. */
  formHash: Schema.String
})

export type ResponseForm = typeof ResponseForm.Type

export const FormAnswerSource = Schema.Literals(["hint", "model", "human"])

export type FormAnswerSource = typeof FormAnswerSource.Type

export const FormAnswer = Schema.Struct({
  questionId: Schema.String,
  optionIds: Schema.optional(Schema.Array(Schema.String)),
  text: Schema.optional(Schema.String),
  source: FormAnswerSource,
  /** True when the answer comes from a hard hint the model may not rewrite. */
  hard: Schema.Boolean,
  confidence: Schema.optional(Schema.Number),
  needsHuman: Schema.Boolean,
  evidence: Schema.optional(Schema.Array(Schema.String))
})

export type FormAnswer = typeof FormAnswer.Type
