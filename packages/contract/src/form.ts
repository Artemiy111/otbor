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

/**
 * A deterministic hint as stored next to the form. Mirrors `AnswerHint` of
 * `@otbor/domain`, which is the only producer.
 */
export const StoredHint = Schema.Struct({
  questionId: Schema.String,
  kind: Schema.String,
  optionIds: Schema.optional(Schema.Array(Schema.String)),
  text: Schema.optional(Schema.String),
  hard: Schema.Boolean,
  confidence: Schema.Number,
  note: Schema.NullOr(Schema.String),
  evidence: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String)
})

export type StoredHint = typeof StoredHint.Type

/** The prepared form of one application: what the cloud parsed and hinted. */
export const StoredForm = Schema.Struct({
  form: ResponseForm,
  hints: Schema.Array(StoredHint),
  url: Schema.String,
  fetchedAt: Schema.String
})

export type StoredForm = typeof StoredForm.Type

/**
 * A kit answer as plain text for a human: the question and what is answered.
 * Understands both `FormAnswer` and the older `{question, answer}` pairs.
 */
export const describeKitAnswer = (
  answer: { readonly questionId: string; readonly optionIds?: ReadonlyArray<string>; readonly text?: string }
    | { readonly question: string; readonly answer: string },
  form?: { readonly questions: ReadonlyArray<FormQuestion> } | null
): { readonly question: string; readonly answer: string } => {
  if ("question" in answer) return { question: answer.question, answer: answer.answer }
  const question = form?.questions.find((item) => item.id === answer.questionId)
  const chosen = (answer.optionIds ?? []).map(
    (id) => question?.options.find((option) => option.id === id)?.label ?? id
  )
  const text = (answer.text ?? "").trim()
  return {
    question: question?.text ?? answer.questionId,
    answer: [...chosen, ...(text === "" ? [] : [text])].join("\n")
  }
}
