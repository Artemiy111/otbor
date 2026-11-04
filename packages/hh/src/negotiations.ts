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

/**
 * The negotiations evidence of a page: a template holding only
 * `applicantNegotiations`. The whole initial state of a logged-in page is
 * larger than any sane fragment limit (about 540 KB), and cutting it
 * mid-JSON loses the closing tag, so the list would read as unreadable.
 * Falls back to the plain fragment when the state cannot be read.
 */
export const negotiationsStateFragment = (html: string, max = 400_000): string | null => {
  const negotiations = readInitialState(html)?.applicantNegotiations
  if (negotiations === undefined || negotiations === null) return initialStateFragment(html, max)
  const json = JSON.stringify({ applicantNegotiations: negotiations })
    .replace(/</g, "\\u003c")
  const fragment = `<template id="HH-Lux-InitialState">${json}</template>`
  return fragment.length <= max ? fragment : initialStateFragment(html, max)
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
  /** Date of the last change hh shows (ISO 8601), when it ships one. */
  readonly changedAt: string | null
  readonly employerName: string | null
  /** The vacancy title, when the list entry carries it. */
  readonly vacancyName: string | null
  /** The hh resume the response was sent with (hh's numeric resume id), when the entry carries it. */
  readonly resumeId: string | null
}

export interface NegotiationsPage {
  /** `topicList` was present. An empty but readable page is a real empty page. */
  readonly readable: boolean
  readonly topics: ReadonlyArray<NegotiationTopic>
  /** Total pages of the list as hh reports them, or `null` when it does not. */
  readonly pageCount: number | null
}

const unreadable: NegotiationsPage = { readable: false, topics: [], pageCount: null }

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

/**
 * hh ships dates as ISO strings, epoch milliseconds or `{ "@timestamp": ms }`.
 * Anything else is "no date", never a guess.
 */
const dateOf = (value: unknown): string | null => {
  let raw: unknown = value
  if (typeof raw === "object" && raw !== null) {
    raw = (raw as Record<string, unknown>)["@timestamp"] ?? (raw as Record<string, unknown>).timestamp
  }
  let date: Date | null = null
  if (typeof raw === "number" && Number.isFinite(raw)) date = new Date(raw)
  else if (typeof raw === "string" && raw.trim() !== "") date = new Date(raw.trim())
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

const firstDate = (...values: ReadonlyArray<unknown>): string | null => {
  for (const value of values) {
    const date = dateOf(value)
    if (date !== null) return date
  }
  return null
}

const employerOf = (topic: Record<string, unknown>): string | null => {
  const direct = text(topic.employerName) ?? text(topic.companyName)
  if (direct !== null) return direct
  const nested = topic.employer
  return typeof nested === "object" && nested !== null
    ? text((nested as Record<string, unknown>).name)
    : null
}

const positiveInt = (value: unknown): number | null => {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null
}

/** Page count from `applicantNegotiations.paging`, in the shapes hh uses for lists. */
const pageCountOf = (negotiations: Record<string, unknown>): number | null => {
  // A logged-in page carries the count itself, as a numeric string.
  const top = positiveInt(negotiations.pageCount)
  if (top !== null) return top
  const paging = negotiations.paging
  if (typeof paging !== "object" || paging === null) return null
  const record = paging as Record<string, unknown>
  const direct = positiveInt(record.pages) ?? positiveInt(record.pagesCount) ?? positiveInt(record.pageCount)
  if (direct !== null) return direct
  const last = record.lastPage
  if (typeof last === "object" && last !== null) {
    const page = (last as Record<string, unknown>).page
    if (typeof page === "number" && Number.isInteger(page) && page >= 0) return page + 1
  }
  return null
}

const idOf = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return text(value)
}

const resumeOf = (topic: Record<string, unknown>): string | null => {
  const nested = topic.resume
  return (
    idOf(topic.resumeId) ??
    (typeof nested === "object" && nested !== null
      ? idOf((nested as Record<string, unknown>).id ?? (nested as Record<string, unknown>).resumeId)
      : null)
  )
}

export const parseNegotiations = (html: string): NegotiationsPage => {
  const state = readInitialState(html)
  const negotiations = state?.applicantNegotiations
  const record =
    typeof negotiations === "object" && negotiations !== null
      ? (negotiations as Record<string, unknown>)
      : undefined
  const list = record?.topicList
  if (record === undefined || !Array.isArray(list)) return unreadable

  const topics: Array<NegotiationTopic> = []
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      // One unreadable entry makes the whole page untrustworthy.
      return unreadable
    }
    const topic = item as Record<string, unknown>
    const vacancyId = idOf(topic.vacancyId)
    if (vacancyId === null) return unreadable
    topics.push({
      vacancyId,
      state: text(topic.lastState) ?? text(topic.initialState),
      employerState: text(topic.lastEmployerState),
      substate: text(topic.lastSubState),
      discardReason: text(topic.discardReason),
      archived: topic.archived === true,
      changedAt: firstDate(
        topic.lastModified,
        topic.lastChangeTime,
        topic.lastStateChangeTime,
        topic.updateTime,
        topic.creationTime
      ),
      employerName: employerOf(topic),
      vacancyName: text(topic.vacancyName) ?? text(topic.vacancyTitle),
      resumeId: resumeOf(topic)
    })
  }
  return { readable: true, topics, pageCount: pageCountOf(record) }
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
