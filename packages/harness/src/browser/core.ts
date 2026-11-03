import type {
  FormAnswer,
  HarnessExit,
  PrepareArtifacts,
  ReconcileEvidence,
  ReconcilePage,
  ResponseForm,
  SubmitEvidence,
  SubmitJobPayload
} from "@otbor/contract"
import {
  classifyResponsePage,
  formFragment,
  initialStateFragment,
  MAX_ARTIFACT_HTML,
  pageExcerpt,
  parseNegotiations,
  parseResponseForm,
  type ResponsePageKind
} from "@otbor/hh"

/**
 * The browser-free half of the executor: what a page means and what to do
 * about it. The Playwright executor only moves pixels and feeds these
 * functions the HTML it sees, so the decisions are testable on fixtures.
 */

export const responseUrl = (baseUrl: string, externalId: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/applicant/vacancy_response?vacancyId=${encodeURIComponent(externalId)}`

/** Evidence for an exit reported before the submit button was pressed. */
const unclicked = (url: string, marker: SubmitEvidence["marker"] = "none"): SubmitEvidence => ({
  clicked: false,
  url,
  marker
})

const preClick = (
  tag: HarnessExit["tag"],
  message: string,
  url: string,
  extra: Partial<HarnessExit> = {}
): HarnessExit => ({
  tag,
  message,
  ...extra,
  artifacts: { ...unclicked(url) }
})

/* -------------------------------------------------------------------------- */
/* Prepare                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The prepare exit for a settled page. The form is returned as a fragment and
 * the cloud parses it; the harness decides nothing about the questions.
 */
export const prepareExit = (html: string, url: string): HarnessExit => {
  const kind = classifyResponsePage(html, url)
  switch (kind) {
    case "form": {
      const artifacts: PrepareArtifacts = { url, html: formFragment(html) }
      return { tag: "prepared", artifacts: { ...artifacts } }
    }
    case "login":
      return { tag: "session_expired", message: "hh redirected to the login page" }
    case "captcha":
      return { tag: "captcha", message: "hh asked for a captcha" }
    case "responded":
      return { tag: "already_responded", message: "hh already holds a response" }
    case "archived":
      return { tag: "vacancy_archived", message: "the vacancy is archived" }
    case "relocation":
      // Confirming the warning may send the response at once, and a prepare
      // must never send anything.
      return {
        tag: "relocation_warning",
        message: "hh shows a relocation warning; prepare does not confirm it"
      }
    case "unknown":
      return {
        tag: "blocked",
        message: `the response page was not recognized: ${pageExcerpt(html, 200)}`
      }
  }
}

/* -------------------------------------------------------------------------- */
/* Submit: pre-flight                                                         */
/* -------------------------------------------------------------------------- */

export type FillStep =
  | { readonly kind: "check"; readonly selector: string; readonly questionId: string }
  | {
      readonly kind: "fill"
      readonly selector: string
      readonly text: string
      readonly questionId: string
    }

const attr = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

export const LETTER_SELECTOR =
  'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[data-qa*="letter"], textarea[name="letter"]'

export const SUBMIT_SELECTOR = '[data-qa="vacancy-response-submit-popup"]'

export const RELOCATION_SELECTOR = '[data-qa="relocation-warning-confirm"]'

export const LETTER_ATTACH_SELECTOR = '[data-qa="responded-success-attach-cover-letter"]'

export type FillPlan =
  | { readonly _tag: "plan"; readonly steps: ReadonlyArray<FillStep> }
  | { readonly _tag: "missing"; readonly questionId: string; readonly message: string }

/**
 * Turns the kit's answers into DOM steps for the live form. A required
 * question without an answer, or an answer for a control the form does not
 * offer, aborts before anything is touched.
 */
export const fillPlan = (form: ResponseForm, answers: ReadonlyArray<FormAnswer>): FillPlan => {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  const steps: Array<FillStep> = []

  for (const question of form.questions) {
    const answer = byQuestion.get(question.id)
    const optionIds = answer?.optionIds ?? []
    const text = (answer?.text ?? "").trim()

    if (question.kind === "single" || question.kind === "multiple") {
      if (optionIds.length === 0) {
        if (question.required) {
          return { _tag: "missing", questionId: question.id, message: "no option chosen" }
        }
        continue
      }
      const offered = new Set(question.options.map((option) => option.id))
      for (const id of optionIds) {
        if (!offered.has(id)) {
          return { _tag: "missing", questionId: question.id, message: `option ${id} is not offered` }
        }
        steps.push({
          kind: "check",
          selector: `input[name="task_${attr(question.id)}"][value="${attr(id)}"]`,
          questionId: question.id
        })
      }
      continue
    }

    if (text === "") {
      if (question.required) {
        return { _tag: "missing", questionId: question.id, message: "no text answer" }
      }
      continue
    }
    steps.push({
      kind: "fill",
      selector: `textarea[name="task_${attr(question.id)}_text"]`,
      text,
      questionId: question.id
    })
  }

  return { _tag: "plan", steps }
}

export type SubmitPreflight =
  /** Nothing to click: report this exit (the evidence says `clicked: false`). */
  | { readonly _tag: "exit"; readonly exit: HarnessExit }
  /** The warning has to be confirmed before the form shows. */
  | { readonly _tag: "relocation" }
  | {
      readonly _tag: "fill"
      readonly form: ResponseForm
      readonly steps: ReadonlyArray<FillStep>
    }

/**
 * Checks the live page against the job before any field is touched: session,
 * captcha, archived, already responded, and above all that the live form is
 * the form the kit was written for.
 */
export const submitPreflight = (
  payload: Pick<SubmitJobPayload, "expectedFormHash" | "kit">,
  html: string,
  url: string
): SubmitPreflight => {
  const kind: ResponsePageKind = classifyResponsePage(html, url)
  switch (kind) {
    case "login":
      return { _tag: "exit", exit: preClick("session_expired", "hh redirected to the login page", url) }
    case "captcha":
      return {
        _tag: "exit",
        exit: {
          tag: "captcha",
          message: "hh asked for a captcha",
          artifacts: { ...unclicked(url, "captcha") }
        }
      }
    case "archived":
      return { _tag: "exit", exit: preClick("vacancy_archived", "the vacancy is archived", url) }
    case "responded":
      return {
        _tag: "exit",
        exit: preClick("already_responded", "hh already holds a response", url)
      }
    case "unknown":
      return {
        _tag: "exit",
        exit: preClick("blocked", `the response page was not recognized: ${pageExcerpt(html, 200)}`, url)
      }
    case "relocation":
      return { _tag: "relocation" }
    case "form":
      break
  }

  const form = parseResponseForm(html, url)
  if (form.layout === "unknown") {
    return {
      _tag: "exit",
      exit: preClick("form_changed", "the live form layout was not recognized", url, {
        formHash: form.formHash
      })
    }
  }
  if (form.formHash !== payload.expectedFormHash) {
    return {
      _tag: "exit",
      exit: preClick(
        "form_changed",
        `the live form (${form.formHash}) is not the form the kit was written for (${payload.expectedFormHash})`,
        url,
        { formHash: form.formHash }
      )
    }
  }

  const plan = fillPlan(form, payload.kit.answers)
  if (plan._tag === "missing") {
    return {
      _tag: "exit",
      exit: preClick(
        "answer_rejected",
        `question ${plan.questionId}: ${plan.message}`,
        url
      )
    }
  }
  return { _tag: "fill", form, steps: plan.steps }
}

/* -------------------------------------------------------------------------- */
/* Submit: after the click                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The exit after the click. Whatever the page shows, `clicked` is `true`: the
 * cloud, not this function, decides whether that is success. Only a responded
 * page is reported as `submitted`; a captcha is reported as such; everything
 * else is `ambiguous` and ends in a reconcile, never in a second click.
 */
export const postClickExit = (
  html: string | null,
  url: string,
  extra: { readonly letterAttached?: boolean } = {}
): HarnessExit => {
  if (html === null) {
    return {
      tag: "ambiguous",
      message: "the page could not be read after the click",
      artifacts: { clicked: true, url, marker: "none" } satisfies SubmitEvidence
    }
  }
  const kind = classifyResponsePage(html, url)
  const evidence = (marker: SubmitEvidence["marker"]): SubmitEvidence => ({
    clicked: true,
    url,
    marker,
    html: html.slice(0, 400_000),
    ...(extra.letterAttached === undefined ? {} : { letterAttached: extra.letterAttached })
  })

  switch (kind) {
    case "responded":
      return { tag: "submitted", artifacts: { ...evidence("success") } }
    case "captcha":
      return {
        tag: "captcha",
        message: "hh asked for a captcha after the click",
        artifacts: { ...evidence("captcha") }
      }
    default:
      return {
        tag: "ambiguous",
        message: `hh did not confirm the response (${kind}): ${pageExcerpt(html, 200)}`,
        artifacts: { ...evidence(kind === "form" ? "error" : "none") }
      }
  }
}

/* -------------------------------------------------------------------------- */
/* Reconcile                                                                  */
/* -------------------------------------------------------------------------- */

export const vacancyUrl = (baseUrl: string, externalId: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/vacancy/${encodeURIComponent(externalId)}`

export const negotiationsUrl = (baseUrl: string, page: number): string =>
  `${baseUrl.replace(/\/+$/, "")}/applicant/negotiations?page=${page}`

/** Negotiation pages read at most; a longer list is not exhausted, and the cloud knows. */
export const MAX_NEGOTIATION_PAGES = 8

/**
 * Whether another negotiations page is worth opening. This only saves
 * requests; it does not say whether a response exists.
 */
export const wantsMoreNegotiations = (html: string, externalId: string): boolean => {
  const page = parseNegotiations(html)
  return (
    page.readable &&
    page.topics.length > 0 &&
    !page.topics.some((topic) => topic.vacancyId === externalId)
  )
}

/**
 * The reconcile exit: the pages that were read, as evidence. A redirect to the
 * login page or a captcha is reported as such; otherwise the harness says only
 * `reconciled` ("I looked") and leaves the verdict to the cloud.
 */
export const reconcileExit = (
  externalId: string,
  read: {
    readonly vacancy?: ReconcilePage
    readonly negotiations: ReadonlyArray<ReconcilePage>
  }
): HarnessExit => {
  const pages = [...(read.vacancy === undefined ? [] : [read.vacancy]), ...read.negotiations]
  for (const page of pages) {
    const kind = classifyResponsePage(page.html, page.url)
    if (kind === "login") {
      return { tag: "session_expired", message: "hh redirected to the login page" }
    }
    if (kind === "captcha") return { tag: "captcha", message: "hh asked for a captcha" }
  }

  const evidence: ReconcileEvidence = {
    externalId,
    ...(read.vacancy === undefined
      ? {}
      : { vacancy: { url: read.vacancy.url, html: read.vacancy.html.slice(0, MAX_ARTIFACT_HTML) } }),
    negotiations: read.negotiations.map((page) => ({
      url: page.url,
      // The list lives in the page's initial state; the rest of the page is
      // not evidence and can be large.
      html: initialStateFragment(page.html) ?? page.html.slice(0, 20_000)
    }))
  }
  return { tag: "reconciled", artifacts: { ...evidence } }
}
