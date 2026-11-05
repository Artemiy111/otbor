import type { ApplicationDetail, FormAnswer, KitAnswer, StoredForm, StoredHint } from "@otbor/contract"
import { type AnswerHint, checkTextStyle, validateAnswers } from "@otbor/domain"
import { Schema } from "effect"

/**
 * Pure helpers for the apply flow: a compact view of a prepared form, the
 * kit status, and a local pre-validation that mirrors the cloud's `checkKit`.
 * The cloud stays the authority; this only lets the model see every problem in
 * one round trip instead of one failed approve per problem.
 */

const NullableString = Schema.NullOr(Schema.String)

/**
 * The rules for everything sent to an employer, in one place: returned by
 * `cover_letter_context` and enforced by `kit_set` where a machine can check.
 */
export const STYLE_RULES: ReadonlyArray<string> = [
  "No em dash or other long dash, no emoji, no exclamation mark, in the letter and in every text answer (kit_set rejects them).",
  "Truthful: use only facts from the resume and its enrichment; never invent experience, employers, numbers or tools. If the resume does not support a claim, leave it out or ask the user.",
  "Specific: tie two or three concrete things from the resume to what the vacancy asks for; no generic praise, no filler.",
  "Write in the language of the vacancy. Keep the letter short (a few short paragraphs) and plain.",
  "Form answers: honor maxLength; answer choice questions with option ids, not labels; hints with hard: true are answered exactly as hinted.",
  "A question with a hint that has blockers, and every code question, needs the user's own answer: ask them and save it with source \"human\". Never write code answers yourself.",
  "Salary and relocation or other personal-fact questions follow the resume enrichment; if it is silent, ask the user.",
  "Enrichment faq entries are the operator's instructions on how to answer common questions (city, relocation, notice period, leave reason and so on): follow them, rephrase to fit the question, never contradict them. Salary comes from the slot in the vacancy's currency; do not convert between currencies.",
  "Per-job notes in enrichment.experience are the operator's context for that job; use them when a question is about that job."
]

export const FormQuestionView = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  text: Schema.String,
  required: Schema.Boolean,
  maxLength: Schema.NullOr(Schema.Int),
  codeLanguage: NullableString,
  options: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })),
  hint: Schema.NullOr(Schema.Struct({
    kind: Schema.String,
    optionIds: Schema.Array(Schema.String),
    text: NullableString,
    hard: Schema.Boolean,
    note: NullableString,
    blockers: Schema.Array(Schema.String)
  })),
  /** What the saved kit currently answers, readable; null when unanswered. */
  answered: NullableString
})

export const PrepareStatus = Schema.Struct({
  /** prepared: form stored. pending: waiting for the browser harness. blocked: needs a human. skipped. */
  status: Schema.Literals(["prepared", "unreadable", "pending", "blocked", "skipped"]),
  detail: NullableString
})

export const KitStatus = Schema.Struct({
  exists: Schema.Boolean,
  /** The kit was written for the form that is stored now. */
  forCurrentForm: Schema.Boolean,
  letterChars: Schema.Int,
  answeredQuestionIds: Schema.Array(Schema.String),
  /** Problems the cloud would raise on approve, found locally. Empty when none. */
  problems: Schema.Array(Schema.String),
  readyToApprove: Schema.Boolean
})

export const FormView = Schema.Struct({
  prepare: PrepareStatus,
  formHash: NullableString,
  coverLetter: NullableString,
  questions: Schema.Array(FormQuestionView),
  kit: KitStatus
})
export type FormView = typeof FormView.Type

/* ------------------------------ kit problems ------------------------------- */

export interface KitIssue {
  readonly code: string
  readonly questionId: string
  readonly message: string
}

type Question = StoredForm["form"]["questions"][number]

export const formatIssues = (
  issues: ReadonlyArray<KitIssue>,
  questions: ReadonlyArray<Pick<Question, "id" | "text">> = []
): ReadonlyArray<string> =>
  issues.map((issue) => {
    const question = questions.find((q) => q.id === issue.questionId)
    const where = issue.questionId === "" || issue.questionId === "letter"
      ? issue.questionId === "letter" ? "cover letter: " : ""
      : question === undefined
      ? `question ${issue.questionId}: `
      : `question ${issue.questionId} "${question.text.slice(0, 60)}": `
    return `[${issue.code}] ${where}${issue.message}`
  })

const asAnswerHints = (hints: ReadonlyArray<StoredHint>) => hints as unknown as ReadonlyArray<AnswerHint>

/**
 * Everything the cloud's `checkKit` would reject, plus the letter style. The
 * cloud does not look at the letter's style; the house rules still apply.
 */
export const prevalidateKit = (
  stored: StoredForm,
  kit: { readonly letter?: string | null; readonly answers: ReadonlyArray<FormAnswer> }
): ReadonlyArray<KitIssue> => {
  const { form, hints } = stored
  if (form.layout === "unknown") {
    return [{ code: "form_unreadable", questionId: "", message: "the form layout was not recognized; a human must fill it in" }]
  }
  const issues: Array<KitIssue> = [...validateAnswers(form, kit.answers, asAnswerHints(hints))]
  const byQuestion = new Map(kit.answers.map((answer) => [answer.questionId, answer]))

  for (const answer of kit.answers) {
    if (answer.needsHuman && answer.source !== "human") {
      issues.push({
        code: "needs_human",
        questionId: answer.questionId,
        message: "the answer is flagged for a human and was not confirmed by one"
      })
    }
  }
  for (const question of form.questions) {
    if (question.kind !== "code") continue
    const answer = byQuestion.get(question.id)
    if (answer === undefined || answer.source !== "human" || answer.needsHuman) {
      issues.push({
        code: "code_needs_human",
        questionId: question.id,
        message: "a code question needs an answer written or confirmed by the user (source \"human\")"
      })
    }
  }
  for (const hint of hints) {
    if (hint.blockers.length === 0) continue
    const answer = byQuestion.get(hint.questionId)
    if (answer !== undefined && answer.source === "human" && !answer.needsHuman) continue
    issues.push({
      code: "hint_blocked",
      questionId: hint.questionId,
      message: `blocked: ${hint.blockers.join(", ")}; ask the user and answer with source "human"`
    })
  }

  const letter = kit.letter ?? ""
  if (form.coverLetter === "required" && letter.trim() === "") {
    issues.push({ code: "letter_required", questionId: "", message: "the form requires a cover letter" })
  }
  const violations = checkTextStyle(letter)
  if (violations.length > 0) {
    const codes = [...new Set(violations.map((violation) => violation.code))]
    issues.push({ code: "banned_style", questionId: "letter", message: `banned style: ${codes.join(", ")}` })
  }
  return issues
}

/* ------------------------------- form view -------------------------------- */

const isFormAnswer = (answer: KitAnswer): answer is FormAnswer => "questionId" in answer

const readable = (answer: FormAnswer, question: Question): string => {
  const chosen = (answer.optionIds ?? []).map(
    (id) => question.options.find((option) => option.id === id)?.label ?? id
  )
  const text = (answer.text ?? "").trim()
  return [...chosen, ...(text === "" ? [] : [text])].join(" | ")
}

const prepareStatus = (detail: ApplicationDetail): typeof PrepareStatus.Type => {
  if (detail.form != null) {
    return detail.form.form.layout === "unknown"
      ? { status: "unreadable", detail: "the form layout was not recognized; a human must fill it in on hh.ru" }
      : { status: "prepared", detail: null }
  }
  if (detail.application.state === "skipped") return { status: "skipped", detail: "the application was skipped" }
  const last = [...detail.attempts].filter((a) => a.stage === "prepare").sort((a, b) => b.seq - a.seq)[0]
  if (last?.finishedAt != null && last.exit != null && last.exit.tag !== "prepared") {
    return {
      status: "blocked",
      detail: `${last.exit.tag}${last.exit.message === undefined ? "" : `: ${last.exit.message}`}`
    }
  }
  if (detail.application.state === "needs_human" || detail.application.state === "failed") {
    return { status: "blocked", detail: `application is ${detail.application.state}; see application_get attempts` }
  }
  return { status: "pending", detail: "waiting for the browser harness to open the response form; poll again in a few seconds" }
}

export const formView = (detail: ApplicationDetail): FormView => {
  const prepare = prepareStatus(detail)
  const stored = detail.form ?? null
  const kit = detail.kit ?? null

  if (stored === null) {
    return {
      prepare,
      formHash: null,
      coverLetter: null,
      questions: [],
      kit: {
        exists: kit !== null,
        forCurrentForm: false,
        letterChars: (kit?.letter ?? "").length,
        answeredQuestionIds: [],
        problems: [],
        readyToApprove: false
      }
    }
  }

  const form = stored.form
  const forCurrentForm = kit !== null && kit.formHash === form.formHash
  const answers = forCurrentForm ? kit.answers.filter(isFormAnswer) : []
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  const problems = kit === null
    ? ["no kit yet: call kit_set"]
    : !forCurrentForm
    ? [`[form_changed] the kit was written for another form (${kit.formHash}); call kit_set again`]
    : formatIssues(prevalidateKit(stored, { letter: kit.letter, answers }), form.questions)

  return {
    prepare,
    formHash: form.formHash,
    coverLetter: form.coverLetter,
    questions: form.questions.map((question) => {
      const hint = stored.hints.find((h) => h.questionId === question.id)
      const answer = byQuestion.get(question.id)
      return {
        id: question.id,
        kind: question.kind,
        text: question.text,
        required: question.required,
        maxLength: question.maxLength ?? null,
        codeLanguage: question.codeLanguage ?? null,
        options: question.options.map((option) => ({ id: option.id, label: option.label })),
        hint: hint === undefined
          ? null
          : {
              kind: hint.kind,
              optionIds: hint.optionIds ?? [],
              text: hint.text ?? null,
              hard: hint.hard,
              note: hint.note,
              blockers: hint.blockers
            },
        answered: answer === undefined ? null : readable(answer, question)
      }
    }),
    kit: {
      exists: kit !== null,
      forCurrentForm,
      letterChars: (kit?.letter ?? "").trim().length,
      answeredQuestionIds: answers.map((answer) => answer.questionId),
      problems,
      readyToApprove: kit !== null && forCurrentForm && problems.length === 0
    }
  }
}
