import {
  type FormAnswer,
  type HarnessExit,
  type HarnessExitTag,
  type KitAnswer,
  LetterAttachEvidence,
  NegotiationsSyncEvidence,
  PrepareArtifacts,
  ReconcileEvidence,
  ResumeSyncEvidence,
  type ResponseForm,
  type StoredHint,
  SubmitEvidence
} from "@otbor/contract"
import { type AnswerHint, validateAnswers } from "@otbor/domain"
import {
  classifyResponsePage,
  isSubmitSuccess,
  type NegotiationTopic,
  pageExcerpt,
  parseNegotiations,
  type ParsedResume,
  parseResumePage,
  parseResumeRefs,
  readResponseStatus,
  type ResponsePageKind,
  type VacancyResponseState
} from "@otbor/hh"
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

/* -------------------------------------------------------------------------- */
/* Reconcile                                                                  */
/* -------------------------------------------------------------------------- */

/** What the cloud itself read from the reconcile pages. Stored on the attempt. */
export interface ReconcileReading {
  readonly externalId: string
  readonly vacancy: {
    readonly state: VacancyResponseState
    readonly markers: ReadonlyArray<string>
    readonly url: string | null
  }
  readonly negotiations: {
    readonly pages: number
    /** Every page readable. */
    readonly readable: boolean
    /** The vacancy is in the list. */
    readonly found: boolean
    /** Pages run to an empty one, so "absent" means absent. */
    readonly exhausted: boolean
    readonly topic: { readonly state: string | null; readonly archived: boolean } | null
  }
}

export type ReconcileVerdict =
  /** A response exists. Whatever the submit said, the application is submitted. */
  | { readonly _tag: "submitted"; readonly reading: ReconcileReading; readonly reason: string }
  /**
   * Both reads were clear and show no response: the click did not reach hh.
   * The application goes back to a human; nothing is queued.
   */
  | { readonly _tag: "unsent"; readonly reading: ReconcileReading; readonly reason: string }
  /** Login or captcha: only a person can continue. */
  | { readonly _tag: "human"; readonly reason: string }
  /** Unreadable, contradictory or missing: read again, bounded. */
  | {
      readonly _tag: "retry"
      readonly reason: string
      readonly reading?: ReconcileReading
    }

/**
 * Decides an ambiguous submit from the pages a reconcile harness read.
 *
 * The harness's tag is not a verdict: a bare `submitted` or `not_submitted` is
 * a claim without evidence and is read again. Only the cloud's own reading of
 * the pages settles anything, and only a clear reading of both pages settles
 * "no response". Every doubt keeps the application in reconcile; no outcome
 * of this function ever queues a second submit.
 */
export const judgeReconcile = (
  exit: HarnessExit,
  externalId: string,
  /**
   * hh's id of the resume the application was made with. hh keeps one response
   * per resume, so with it only the topic of that resume counts, and the vacancy
   * page (which shows a response made with any resume) proves nothing alone.
   */
  resumeExternalId: string | null = null
): ReconcileVerdict => {
  if (exit.tag === "session_expired") {
    return { _tag: "human", reason: "hh session expired; log in again" }
  }
  if (exit.tag === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  if (exit.tag !== "reconciled") {
    return { _tag: "retry", reason: `reconcile came without page evidence (${exit.tag})` }
  }

  const decoded = Schema.decodeUnknownOption(ReconcileEvidence)(exit.artifacts)
  if (Option.isNone(decoded)) {
    return { _tag: "retry", reason: "reconcile evidence is not readable" }
  }
  const evidence = decoded.value
  if (evidence.externalId !== externalId) {
    return { _tag: "retry", reason: "reconcile evidence is for another vacancy" }
  }

  const pages = evidence.negotiations ?? []
  for (const page of [...(evidence.vacancy === undefined ? [] : [evidence.vacancy]), ...pages]) {
    const kind = classifyResponsePage(page.html, page.url)
    if (kind === "login") return { _tag: "human", reason: "hh session expired; log in again" }
    if (kind === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  }

  const vacancy =
    evidence.vacancy === undefined
      ? {
          state: "unreadable" as VacancyResponseState,
          markers: [] as ReadonlyArray<string>,
          url: null as string | null
        }
      : {
          ...readResponseStatus(evidence.vacancy.html, externalId, evidence.vacancy.url),
          url: evidence.vacancy.url as string | null
        }

  const parsed = pages.map((page) => parseNegotiations(page.html))
  const topic =
    parsed
      .flatMap((page) => page.topics)
      .find(
        (candidate) =>
          candidate.vacancyId === externalId &&
          (resumeExternalId === null || candidate.resumeId === resumeExternalId)
      ) ?? null
  const readable = parsed.length > 0 && parsed.every((page) => page.readable)
  const last = parsed[parsed.length - 1]
  const exhausted = readable && last !== undefined && last.topics.length === 0

  const reading: ReconcileReading = {
    externalId,
    vacancy: { state: vacancy.state, markers: vacancy.markers, url: vacancy.url },
    negotiations: {
      pages: pages.length,
      readable,
      found: topic !== null,
      exhausted,
      topic: topic === null ? null : { state: topic.state, archived: topic.archived }
    }
  }

  // The vacancy page cannot say which resume the response was made with.
  const vacancyResponded = vacancy.state === "responded" && resumeExternalId === null
  const vacancyNo = vacancy.state === "not_responded"
  const found = topic !== null
  // The list says "absent" only when it was read to the end.
  const listNo = !found && exhausted

  if ((vacancyResponded || found) && (vacancyNo || (vacancyResponded && listNo))) {
    return {
      _tag: "retry",
      reading,
      reason: vacancyNo
        ? "contradiction: the negotiations list holds the vacancy, the vacancy page shows no response"
        : "contradiction: the vacancy page shows a response, the negotiations list does not hold it"
    }
  }

  if (vacancyResponded || found) {
    const sources = [vacancyResponded ? "vacancy page" : null, found ? "negotiations list" : null]
    return {
      _tag: "submitted",
      reading,
      reason: `a response exists (${sources.filter((source) => source !== null).join(", ")})`
    }
  }

  if (vacancyNo && listNo) {
    return {
      _tag: "unsent",
      reading,
      reason: "neither the vacancy page nor the negotiations list shows a response"
    }
  }

  const doubts = [
    vacancy.state === "unreadable" ? "vacancy page unreadable" : null,
    resumeExternalId !== null && vacancy.state === "responded" && !found
      ? "the vacancy page shows a response, but the list holds none made with this resume"
      : null,
    !readable ? "negotiations list unreadable" : null,
    readable && !exhausted ? "negotiations list not read to the end" : null
  ].filter((doubt) => doubt !== null)
  return { _tag: "retry", reading, reason: `reconcile is inconclusive: ${doubts.join(", ")}` }
}

/** The reconcile attempt keeps the cloud's reading and the verdict, not page bodies. */
export const reconcileArtifacts = (
  exit: HarnessExit,
  verdict: ReconcileVerdict
): Record<string, unknown> => {
  const evidence = Schema.decodeUnknownOption(ReconcileEvidence)(exit.artifacts)
  const pages = Option.isSome(evidence)
    ? {
        vacancyBytes: evidence.value.vacancy?.html.length ?? 0,
        vacancyExcerpt:
          evidence.value.vacancy === undefined ? null : pageExcerpt(evidence.value.vacancy.html, 300),
        negotiationsBytes: (evidence.value.negotiations ?? []).reduce(
          (total, page) => total + page.html.length,
          0
        )
      }
    : {}
  return {
    verdict: verdict._tag,
    reason: verdict.reason,
    ...("reading" in verdict && verdict.reading !== undefined ? { reading: verdict.reading } : {}),
    ...pages
  }
}

/* -------------------------------------------------------------------------- */
/* Negotiations sync                                                          */
/* -------------------------------------------------------------------------- */

export type NegotiationsSyncVerdict =
  /** The pages were read: these topics are what hh holds for the account. */
  | {
      readonly _tag: "read"
      readonly topics: ReadonlyArray<NegotiationTopic>
      readonly pages: number
      /** Every page readable and the list read to its end (empty or last page). */
      readonly complete: boolean
    }
  | { readonly _tag: "human"; readonly reason: string }
  | { readonly _tag: "retry"; readonly reason: string }

/**
 * Reads a `negotiations_sync` exit. The harness only delivers pages; whether a
 * page holds responses is the cloud's reading. Pages are read in order and
 * reading stops at the first unreadable one: what was read before it is still
 * real evidence (an import only adds), but `complete` is then false. No page
 * readable at all is a retry, never an empty list.
 */
export const judgeNegotiationsSync = (exit: HarnessExit): NegotiationsSyncVerdict => {
  if (exit.tag === "session_expired") {
    return { _tag: "human", reason: "hh session expired; log in again" }
  }
  if (exit.tag === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  if (exit.tag !== "reconciled") {
    return { _tag: "retry", reason: `negotiations sync came without page evidence (${exit.tag})` }
  }

  const decoded = Schema.decodeUnknownOption(NegotiationsSyncEvidence)(exit.artifacts)
  if (Option.isNone(decoded)) {
    return { _tag: "retry", reason: "negotiations sync evidence is not readable" }
  }
  const pages = decoded.value.pages
  for (const page of pages) {
    const kind = classifyResponsePage(page.html, page.url)
    if (kind === "login") return { _tag: "human", reason: "hh session expired; log in again" }
    if (kind === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  }

  const topics = new Map<string, NegotiationTopic>()
  let readPages = 0
  let complete = false
  for (const raw of pages) {
    const page = parseNegotiations(raw.html)
    if (!page.readable) break
    readPages += 1
    for (const topic of page.topics) {
      // One per vacancy and resume: hh keeps a response, and a chat, for each
      // resume used on the same vacancy. The list is newest first.
      const key = `${topic.vacancyId}|${topic.resumeId ?? ""}`
      if (!topics.has(key)) topics.set(key, topic)
    }
    if (page.topics.length === 0 || (page.pageCount !== null && readPages >= page.pageCount)) {
      complete = true
      break
    }
  }

  if (readPages === 0) {
    return { _tag: "retry", reason: "no negotiations page was readable" }
  }
  return { _tag: "read", topics: [...topics.values()], pages: readPages, complete }
}

/* -------------------------------------------------------------------------- */
/* Resume sync                                                                */
/* -------------------------------------------------------------------------- */

export type ResumeSyncVerdict =
  | {
      readonly _tag: "read"
      /** Resume cards on the profile page. */
      readonly found: number
      readonly resumes: ReadonlyArray<ParsedResume>
      /** Cards whose page was missing or unreadable. */
      readonly unreadable: number
    }
  | { readonly _tag: "human"; readonly reason: string }
  | { readonly _tag: "retry"; readonly reason: string }

/**
 * Reads a `resume_sync` exit. The harness only delivers pages; the cloud finds
 * the cards on the profile page and reads each resume page. A card whose page
 * cannot be read is counted, never stored as an empty resume. A profile with
 * no cards is a retry: an unrendered page and an account without resumes look
 * the same, and storing nothing is the safe reading.
 */
export const judgeResumeSync = (exit: HarnessExit): ResumeSyncVerdict => {
  if (exit.tag === "session_expired") {
    return { _tag: "human", reason: "hh session expired; log in again" }
  }
  if (exit.tag === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  if (exit.tag !== "reconciled") {
    return { _tag: "retry", reason: `resume sync came without page evidence (${exit.tag})` }
  }

  const decoded = Schema.decodeUnknownOption(ResumeSyncEvidence)(exit.artifacts)
  if (Option.isNone(decoded)) {
    return { _tag: "retry", reason: "resume sync evidence is not readable" }
  }
  const { profile, resumes: pages } = decoded.value
  for (const page of [profile, ...pages]) {
    const kind = classifyResponsePage(page.html, page.url)
    if (kind === "login") return { _tag: "human", reason: "hh session expired; log in again" }
    if (kind === "captcha") return { _tag: "human", reason: "hh asked for a captcha" }
  }

  const refs = parseResumeRefs(profile.html)
  if (refs.length === 0) return { _tag: "retry", reason: "the profile page lists no resumes" }

  const byHash = new Map<string, ParsedResume>()
  for (const page of pages) {
    const parsed = parseResumePage(page.html)
    if (parsed !== null) byHash.set(parsed.hash, parsed)
  }
  const resumes = refs.flatMap((ref) => {
    const parsed = byHash.get(ref.hash)
    return parsed === undefined ? [] : [parsed]
  })
  return { _tag: "read", found: refs.length, resumes, unreadable: refs.length - resumes.length }
}

export type LetterAttachVerdict =
  /** hh closed the letter dialog after the click. */
  | { readonly _tag: "sent" }
  /** Nothing was clicked; the reason is for the operator. */
  | { readonly _tag: "failed"; readonly reason: string }
  /** The click may have reached hh: never retried, the operator checks hh. */
  | { readonly _tag: "human"; readonly reason: string }

/**
 * A letter is "sent" only when the harness clicked and the dialog closed. A
 * missing or contradictory `clicked` is treated as a click that may have
 * happened, so an unknown outcome never turns into a second send.
 */
export const judgeLetterAttach = (exit: HarnessExit): LetterAttachVerdict => {
  const evidence = Schema.decodeUnknownOption(LetterAttachEvidence)(exit.artifacts)
  const clicked = Option.isSome(evidence) ? evidence.value.clicked : true
  if (exit.tag === "submitted" && Option.isSome(evidence) && evidence.value.clicked && evidence.value.closed) {
    return { _tag: "sent" }
  }
  if (!clicked) {
    if (exit.tag === "session_expired") return { _tag: "failed", reason: "hh session expired; log in again" }
    if (exit.tag === "captcha") return { _tag: "failed", reason: "hh asked for a captcha" }
    if (exit.tag === "not_submitted") return { _tag: "failed", reason: exit.message ?? "hh shows no response to this vacancy" }
    return { _tag: "failed", reason: exit.message ?? `letter was not sent (${exit.tag})` }
  }
  return {
    _tag: "human",
    reason: exit.message ?? "the letter may have been sent; check the response on hh"
  }
}
