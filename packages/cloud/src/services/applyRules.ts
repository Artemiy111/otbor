import {
  type FormAnswer,
  type HarnessExit,
  type HarnessExitTag,
  type KitAnswer,
  PrepareArtifacts,
  type ResponseForm,
  type StoredHint,
  SubmitEvidence
} from "@otbor/contract"
import { type AnswerHint, validateAnswers } from "@otbor/domain"
import { classifyResponsePage, isSubmitSuccess, pageExcerpt, type ResponsePageKind } from "@otbor/hh"
import { Option, Schema } from "effect"

/**
 * Pure apply rules: kit validation and the cloud's reading of what a browser
 * harness reports. No database, no clock. The harness is untrusted, so every
 * function here treats its exit as a claim and decides from evidence.
 */

/* -------------------------------------------------------------------------- */
/* Kit answers                                                                */
/* -------------------------------------------------------------------------- */

export const isFormAnswer = (answer: KitAnswer): answer is FormAnswer =>
  "questionId" in answer

const fold = (text: string): string =>
  text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim()

/**
 * Brings a stored kit to `FormAnswer[]`. A kit saved before the form parser
 * holds `{question, answer}` pairs; those are matched to form questions by
 * text, option label or free text, and marked as human answers. An answer that
 * cannot be matched keeps its question text as `questionId`, so validation
 * reports it instead of dropping it.
 */
export const toFormAnswers = (
  form: Pick<ResponseForm, "questions"> | null,
  answers: ReadonlyArray<KitAnswer>
): ReadonlyArray<FormAnswer> =>
  answers.map((answer): FormAnswer => {
    if (isFormAnswer(answer)) return answer
    const question = form?.questions.find((item) => fold(item.text) === fold(answer.question))
    if (question === undefined) {
      return {
        questionId: answer.question,
        text: answer.answer,
        source: "human",
        hard: false,
        needsHuman: false
      }
    }
    if (question.kind === "single" || question.kind === "multiple") {
      const wanted = answer.answer
        .split(/\n|;/)
        .map((part) => fold(part))
        .filter((part) => part !== "")
      const optionIds = question.options
        .filter((option) => wanted.includes(fold(option.label)))
        .map((option) => option.id)
      return {
        questionId: question.id,
        optionIds,
        source: "human",
        hard: false,
        needsHuman: false
      }
    }
    return {
      questionId: question.id,
      text: answer.answer,
      source: "human",
      hard: false,
      needsHuman: false
    }
  })

export type KitProblemCode =
  | "form_changed"
  | "form_unreadable"
  | "needs_human"
  | "code_needs_human"
  | "hint_blocked"
  | "letter_required"
  | "unknown_question"
  | "unknown_option"
  | "too_many_options"
  | "required_unanswered"
  | "hard_hint_overridden"
  | "salary_without_number"
  | "text_too_long"
  | "banned_style"

export interface KitProblem {
  readonly code: KitProblemCode
  readonly questionId: string
  readonly message: string
}

export interface KitCheckInput {
  readonly form: ResponseForm
  readonly hints: ReadonlyArray<StoredHint>
  readonly kit: {
    readonly formHash: string
    readonly letter?: string | null
    readonly answers: ReadonlyArray<KitAnswer>
  }
}

const FORM_ID = ""

/**
 * Everything that must be true before a kit may be sent. Returns every problem
 * at once. An empty array means the kit may be approved; it does not mean the
 * answers are true.
 */
export const checkKit = (input: KitCheckInput): ReadonlyArray<KitProblem> => {
  const { form, kit } = input
  if (kit.formHash !== form.formHash) {
    return [
      {
        code: "form_changed",
        questionId: FORM_ID,
        message: `the kit was written for form ${kit.formHash}, the prepared form is ${form.formHash}`
      }
    ]
  }
  if (form.layout === "unknown") {
    return [
      {
        code: "form_unreadable",
        questionId: FORM_ID,
        message: "the form layout was not recognized; a human must fill it in"
      }
    ]
  }

  const problems: Array<KitProblem> = []
  const answers = toFormAnswers(form, kit.answers)
  const hints = input.hints as unknown as ReadonlyArray<AnswerHint>

  for (const error of validateAnswers(form, answers, hints)) {
    problems.push({ code: error.code, questionId: error.questionId, message: error.message })
  }

  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))

  for (const answer of answers) {
    if (answer.needsHuman && answer.source !== "human") {
      problems.push({
        code: "needs_human",
        questionId: answer.questionId,
        message: "the answer is flagged for a human and was not confirmed by one"
      })
    }
  }

  // A code task is never sent from a model or hint answer.
  for (const question of form.questions) {
    if (question.kind !== "code") continue
    const answer = byQuestion.get(question.id)
    if (answer === undefined || answer.source !== "human" || answer.needsHuman) {
      problems.push({
        code: "code_needs_human",
        questionId: question.id,
        message: "a code question needs an answer written or confirmed by a human"
      })
    }
  }

  // A hint with blockers (for example a salary below the stated minimum) is a
  // decision for a person, not for a model.
  for (const hint of input.hints) {
    if (hint.blockers.length === 0) continue
    const answer = byQuestion.get(hint.questionId)
    if (answer !== undefined && answer.source === "human" && !answer.needsHuman) continue
    problems.push({
      code: "hint_blocked",
      questionId: hint.questionId,
      message: `blocked: ${hint.blockers.join(", ")}`
    })
  }

  if (form.coverLetter === "required" && (kit.letter ?? "").trim() === "") {
    problems.push({
      code: "letter_required",
      questionId: FORM_ID,
      message: "the form requires a cover letter"
    })
  }

  return problems
}

/* -------------------------------------------------------------------------- */
/* Prepare                                                                    */
/* -------------------------------------------------------------------------- */

export type PrepareVerdict =
  | { readonly _tag: "form"; readonly artifacts: PrepareArtifacts; readonly page: ResponsePageKind }
  | { readonly _tag: "skip"; readonly reason: string }
  | { readonly _tag: "human"; readonly reason: string }
  | { readonly _tag: "failed"; readonly reason: string }
  | { readonly _tag: "retry" }

/**
 * Reads a prepare exit. `prepared` is believed only after the cloud classified
 * the page it came with; the harness's own tags are used for the cases where
 * it could not deliver a page at all.
 */
export const judgePrepare = (exit: HarnessExit): PrepareVerdict => {
  switch (exit.tag) {
    case "prepared": {
      const artifacts = Schema.decodeUnknownOption(PrepareArtifacts)(exit.artifacts)
      if (Option.isNone(artifacts)) {
        return { _tag: "human", reason: "prepared without a readable page artifact" }
      }
      const page = classifyResponsePage(artifacts.value.html, artifacts.value.url)
      switch (page) {
        case "form":
          return { _tag: "form", artifacts: artifacts.value, page }
        case "responded":
          return { _tag: "skip", reason: "hh already holds a response to this vacancy" }
        case "archived":
          return { _tag: "skip", reason: "the vacancy is archived" }
        case "login":
          return { _tag: "human", reason: "hh session expired; log in again" }
        case "captcha":
          return { _tag: "human", reason: "hh asked for a captcha" }
        case "relocation":
          return {
            _tag: "human",
            reason: "hh shows a relocation warning; confirming it may send the response at once"
          }
        case "unknown":
          return { _tag: "human", reason: "the response page was not recognized" }
      }
      return { _tag: "human", reason: "the response page was not recognized" }
    }
    case "already_responded":
      return { _tag: "skip", reason: "hh already holds a response to this vacancy" }
    case "vacancy_archived":
      return { _tag: "skip", reason: "the vacancy is archived" }
    case "session_expired":
      return { _tag: "human", reason: "hh session expired; log in again" }
    case "captcha":
      return { _tag: "human", reason: "hh asked for a captcha" }
    case "relocation_warning":
      return {
        _tag: "human",
        reason: "hh shows a relocation warning; confirming it may send the response at once"
      }
    case "transport":
    case "rate_limited":
    case "inference_failed":
    case "ambiguous":
      return { _tag: "retry" }
    default:
      return { _tag: "failed", reason: `prepare failed: ${exit.tag}` }
  }
}

/* -------------------------------------------------------------------------- */
/* Submit                                                                     */
/* -------------------------------------------------------------------------- */

/** Tags that can only be reported before the submit button is pressed. */
const PRE_CLICK_TAGS: ReadonlyArray<HarnessExitTag> = [
  "form_changed",
  "session_expired",
  "captcha",
  "answer_rejected",
  "resume_mismatch",
  "blocked",
  "relocation_warning",
  "vacancy_archived",
  "transport",
  "rate_limited",
  "permanent",
  "site_rejected"
]

export type SubmitVerdict =
  /** The post-click page proves the response. */
  | { readonly _tag: "submitted"; readonly evidence: SubmitEvidence }
  /** The click may have reached hh. Never retried; reconcile reads the site. */
  | { readonly _tag: "reconcile"; readonly reason: string }
  /** Provably no click. Safe for a human to prepare again. */
  | {
      readonly _tag: "not_sent"
      readonly tag: HarnessExitTag
      readonly reason: string
      readonly app: "needs_human" | "failed"
    }

export const readSubmitEvidence = (exit: HarnessExit): SubmitEvidence | null => {
  const decoded = Schema.decodeUnknownOption(SubmitEvidence)(exit.artifacts)
  return Option.isSome(decoded) ? decoded.value : null
}

/**
 * Decides `submitted` vs `needs_reconcile` vs "not sent" from the exit and its
 * evidence. The rules, in order:
 *
 * 1. A pre-click tag with `clicked: false` evidence is believed: nothing was
 *    sent.
 * 2. `submitted`/`clicked` with `clicked: true` and a post-click page that the
 *    cloud itself classifies as a responded page is `submitted`.
 * 3. Everything else (timeouts, ambiguous pages, a missing or contradictory
 *    artifact, any exit that is not provably pre-click) is `needs_reconcile`.
 */
export const judgeSubmit = (exit: HarnessExit): SubmitVerdict => {
  const evidence = readSubmitEvidence(exit)

  if (evidence !== null && !evidence.clicked && PRE_CLICK_TAGS.includes(exit.tag)) {
    const app = exit.tag === "form_changed" || exit.tag === "answer_rejected" ? "needs_human" : null
    const human = ["session_expired", "captcha", "relocation_warning", "transport", "rate_limited"]
    return {
      _tag: "not_sent",
      tag: exit.tag,
      app: app ?? (human.includes(exit.tag) ? "needs_human" : "failed"),
      reason: exit.message ?? `submit not sent: ${exit.tag}`
    }
  }

  if (
    (exit.tag === "submitted" || exit.tag === "clicked") &&
    evidence !== null &&
    evidence.clicked &&
    evidence.html !== undefined &&
    isSubmitSuccess(evidence.html, evidence.url)
  ) {
    return { _tag: "submitted", evidence }
  }

  return {
    _tag: "reconcile",
    reason:
      evidence === null
        ? `submit outcome "${exit.tag}" came without evidence`
        : `submit outcome "${exit.tag}" is not proven by the page (${evidence.marker})`
  }
}

/** Artifacts as stored on the attempt: evidence without the page body. */
export const attemptArtifacts = (exit: HarnessExit): Record<string, unknown> | null => {
  const artifacts = exit.artifacts
  if (artifacts === undefined) return null
  const { html, ...rest } = artifacts as Record<string, unknown>
  if (typeof html !== "string") return rest
  return { ...rest, htmlBytes: html.length, excerpt: pageExcerpt(html) }
}
