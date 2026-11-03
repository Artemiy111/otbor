import { htmlToText } from "./text.ts"

/**
 * What the response page (`/applicant/vacancy_response?vacancyId=...`) shows.
 * Pure string checks on markup and URL, so the harness (which has the page) and
 * the cloud (which only has the evidence) reach the same verdict.
 *
 * Markers come from the previous project's browser submit code
 * (`vacancy-response-submit-popup`, `relocation-warning-confirm`,
 * `responded-success-attach-cover-letter`), checked against live pages on
 * 2026-10-28.
 */
export type ResponsePageKind =
  /** Redirected to the login page: the session is gone. */
  | "login"
  | "captcha"
  /** The vacancy is archived or closed; there is nothing to respond to. */
  | "archived"
  /** hh already holds a response of this account (or the click just made one). */
  | "responded"
  /** hh asks to confirm a relocation before it shows the form. */
  | "relocation"
  /** The response form with its submit button. */
  | "form"
  | "unknown"

const LOGIN_URL_RE = /^https?:\/\/[^/]*\/(?:account\/login|login|auth)(?:[/?#]|$)/i
const CAPTCHA_URL_RE = /^https?:\/\/[^/]*\/(?:account\/)?captcha(?:[/?#]|$)/i

const CAPTCHA_TEXT_RE =
  /подтвердите,?\s+что\s+вы\s+не\s+робот|неверный\s+текст\.?\s+пожалуйста,?\s+повторите/i
const CAPTCHA_MARKUP_RE =
  /data-qa=["'][^"']*captcha|class=["'][^"']*captcha|id=["'][^"']*captcha|<img[^>]+src=["'][^"']*captcha/i

const SUCCESS_MARKUP_RE = /data-qa=["']responded-success-attach-cover-letter["']/i
const SUCCESS_TEXT_RE = /вы\s+откликнулись/i

const SUBMIT_MARKUP_RE = /data-qa=["']vacancy-response-submit-popup["']/i
const FORM_MARKUP_RE = /id=["']RESPONSE_MODAL_FORM_ID["']|name=["']vacancy_response["']/i
const RELOCATION_MARKUP_RE = /data-qa=["']relocation-warning-confirm["']/i

const ARCHIVED_TEXT_RE =
  /вакансия\s+в\s+архиве|вакансия\s+закрыта|вакансия\s+не\s+найдена|страница\s+не\s+найдена/i
const ARCHIVED_MARKUP_RE = /data-qa=["']vacancy-archived|data-qa=["']vacancy-response-archived/i

/**
 * Scripts, styles, comments and templates are not what the user sees, and hh
 * pages ship their own state and strings in them. Markers only count in markup.
 */
const visibleMarkup = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")

/** True when the page carries hh's "you responded" state. */
export const hasRespondedMarker = (page: string): boolean => {
  const html = visibleMarkup(page)
  return SUCCESS_MARKUP_RE.test(html) || SUCCESS_TEXT_RE.test(htmlToText(html))
}

export const classifyResponsePage = (page: string, url: string): ResponsePageKind => {
  const html = visibleMarkup(page)
  if (LOGIN_URL_RE.test(url)) return "login"
  if (CAPTCHA_URL_RE.test(url)) return "captcha"

  // A responded page keeps the submit button ("respond again"), so "responded"
  // must win over "form".
  if (hasRespondedMarker(html)) return "responded"
  if (CAPTCHA_MARKUP_RE.test(html) || CAPTCHA_TEXT_RE.test(htmlToText(html))) return "captcha"
  if (SUBMIT_MARKUP_RE.test(html) || FORM_MARKUP_RE.test(html)) return "form"
  if (RELOCATION_MARKUP_RE.test(html)) return "relocation"
  if (ARCHIVED_MARKUP_RE.test(html) || ARCHIVED_TEXT_RE.test(htmlToText(html))) return "archived"
  return "unknown"
}

/**
 * The cloud's own reading of submit evidence. `true` only when the page after
 * the click is a responded page and not simply the form again. It proves the
 * page said so, not that hh stored the response, which is why a reconcile read
 * is still the authority for anything weaker than this.
 */
export const isSubmitSuccess = (html: string, url: string): boolean =>
  classifyResponsePage(html, url) === "responded"

/** Longest page the harness sends as an artifact. */
export const MAX_ARTIFACT_HTML = 400_000

/**
 * The form element when the page has one, otherwise the page itself; both are
 * capped. Keeps the artifact small without hiding what the cloud must parse.
 */
export const formFragment = (html: string): string => {
  const start = html.search(/<form\b[^>]*(?:RESPONSE_MODAL_FORM_ID|vacancy_response)/i)
  if (start >= 0) {
    const end = html.indexOf("</form>", start)
    if (end >= 0) return html.slice(start, end + "</form>".length).slice(0, MAX_ARTIFACT_HTML)
  }
  return html.slice(0, MAX_ARTIFACT_HTML)
}

/** A short, text-only excerpt of a page for evidence and logs. */
export const pageExcerpt = (html: string, max = 600): string =>
  htmlToText(html).replace(/\s+/g, " ").trim().slice(0, max)
