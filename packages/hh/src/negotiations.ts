import { decodeEntities } from "./text.ts"
import { hasRespondedMarker } from "./response.ts"

/**
 * Two pure readings of "did hh record a response to this vacancy":
 *
 * - the vacancy page (`/vacancy/<id>`): is the "you responded" state shown, or
 *   the plain "respond" control;
 * - the applicant negotiations list (`/applicant/negotiations?page=N`): the
 *   `applicantNegotiations.topicList` of the page's initial state.
 *
 * The browser harness only fetches pages; the cloud runs these on the
 * evidence. Both readers say "unreadable" instead of guessing, because the
 * only dangerous mistake is a false "no response".
 *
 * The state path (`applicantNegotiations.topicList` and its fields) is taken
 * from the previous project's negotiations sync. The vacancy page markers
 * (`vacancy-response-link-view-topic`, `vacancy-response-link-top|bottom`) are
 * hh's `data-qa` names for the "view response" and "respond" controls; they are
 * not yet checked against a live logged-in page, so the test fixtures for them
 * are synthetic.
 */

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

const TEMPLATE_RE =
  /<template[^>]*\bid=["']HH-Lux-InitialState["'][^>]*>([\s\S]*?)<\/template>/i

/** The page's initial state, or `null` when it is missing or not JSON. */
export const readInitialState = (html: string): Record<string, unknown> | null => {
  const payload = html.match(TEMPLATE_RE)?.[1]?.trim()
  if (payload === undefined || payload === "") return null
  const attempts = [payload, decodeEntities(payload)]
  for (const text of attempts) {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      // Anonymous hh responses escape the whole JSON payload.
    }
  }
  return null
}

/** The `<template id="HH-Lux-InitialState">` element alone, or `null`. */
export const initialStateFragment = (html: string, max = 400_000): string | null => {
  const match = html.match(TEMPLATE_RE)
  if (match === null) return null
  return match[0].slice(0, max)
}

/* -------------------------------------------------------------------------- */
/* Negotiations list                                                          */
/* -------------------------------------------------------------------------- */

export interface NegotiationTopic {
  readonly vacancyId: string
  readonly state: string | null
  readonly employerState: string | null
  readonly substate: string | null
  readonly discardReason: string | null
  readonly archived: boolean
}

export interface NegotiationsPage {
  /** `topicList` was present. An empty but readable page is a real empty page. */
  readonly readable: boolean
  readonly topics: ReadonlyArray<NegotiationTopic>
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const idOf = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return text(value)
}

export const parseNegotiations = (html: string): NegotiationsPage => {
  const state = readInitialState(html)
  const negotiations = state?.applicantNegotiations
  const list =
    typeof negotiations === "object" && negotiations !== null
      ? (negotiations as Record<string, unknown>).topicList
      : undefined
  if (!Array.isArray(list)) return { readable: false, topics: [] }

  const topics: Array<NegotiationTopic> = []
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      // One unreadable entry makes the whole page untrustworthy.
      return { readable: false, topics: [] }
    }
    const topic = item as Record<string, unknown>
    const vacancyId = idOf(topic.vacancyId)
    if (vacancyId === null) return { readable: false, topics: [] }
    topics.push({
      vacancyId,
      state: text(topic.lastState) ?? text(topic.initialState),
      employerState: text(topic.lastEmployerState),
      substate: text(topic.lastSubState),
      discardReason: text(topic.discardReason),
      archived: topic.archived === true
    })
  }
  return { readable: true, topics }
}

/* -------------------------------------------------------------------------- */
/* Vacancy page                                                               */
/* -------------------------------------------------------------------------- */

export type VacancyResponseState =
  /** The page shows that this account responded. */
  | "responded"
  /** The page is this vacancy and offers the plain "respond" control. */
  | "not_responded"
  /** Anything else: another page, a layout we do not know, an archived vacancy. */
  | "unreadable"

export interface VacancyResponseStatus {
  readonly state: VacancyResponseState
  readonly markers: ReadonlyArray<string>
}

const VIEW_TOPIC_RE = /data-qa=["']vacancy-response-link-view-topic["']/i
const RESPOND_CONTROL_RE = /data-qa=["']vacancy-response-link-(?:top|bottom)["']/i
const TITLE_RE = /data-qa=["']vacancy-title["']/i

const visibleMarkup = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")

const isVacancyUrl = (url: string, externalId: string): boolean => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === `/vacancy/${externalId}`
  } catch {
    return false
  }
}

/**
 * Whether the vacancy page shows a response. `url` must be the page's final
 * URL: a redirect elsewhere (login, another vacancy, the search) is never a
 * reading of this vacancy.
 */
export const readResponseStatus = (
  html: string,
  externalId: string,
  url: string
): VacancyResponseStatus => {
  if (!isVacancyUrl(url, externalId)) return { state: "unreadable", markers: [] }

  const markup = visibleMarkup(html)
  const markers: Array<string> = []
  if (VIEW_TOPIC_RE.test(markup)) markers.push("vacancy-response-link-view-topic")
  if (hasRespondedMarker(markup)) markers.push("responded-text")
  if (markers.length > 0) return { state: "responded", markers }

  // "Not responded" needs the respond control itself, on a page that is the
  // vacancy: an archived vacancy or an unknown layout has no such control and
  // says nothing about the response.
  if (RESPOND_CONTROL_RE.test(markup) && TITLE_RE.test(markup)) {
    return { state: "not_responded", markers: ["vacancy-response-link"] }
  }
  return { state: "unreadable", markers: [] }
}
