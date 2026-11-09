import type { HhSessionState } from "@otbor/contract"
import { classifyResponsePage } from "@otbor/hh"

/** The label an account got before accounts were named after hh's display name. */
export const LEGACY_LABEL = "local"

export interface HhProfileName {
  readonly firstName: string | null
  readonly lastName: string | null
}

const NO_NAME: HhProfileName = { firstName: null, lastName: null }

/** Reads the applicant's name out of the HTML of `/applicant/profile/me`. */
export const parseProfileName = (html: string): HhProfileName => {
  const pick = (key: string) =>
    html.match(new RegExp(`${key}&quot;:&quot;([^&]+)&quot;`))?.[1]?.replace(/&quot;/g, "") ?? null
  return { firstName: pick("firstName"), lastName: pick("lastName") }
}

export const fullName = (name: HhProfileName): string =>
  [name.firstName, name.lastName].filter((part) => part !== null && part !== "").join(" ")

/** A label may be replaced by the hh name only while it is empty or the legacy placeholder. */
export const isReplaceableLabel = (label: string | null | undefined): boolean => {
  const trimmed = (label ?? "").trim()
  return trimmed === "" || trimmed.toLowerCase() === LEGACY_LABEL
}

export interface SessionVerdict {
  readonly state: HhSessionState
  readonly error: string | null
}

/** Turns what hh answered for an authenticated-only page into a session verdict. */
export const judgeSessionResponse = (input: {
  readonly status: number
  readonly url: string
  readonly html: string
}): SessionVerdict => {
  const kind = classifyResponsePage(input.html, input.url)
  if (kind === "captcha" || input.status === 429) {
    return { state: "blocked", error: "hh asked for a captcha" }
  }
  if (kind === "login" || /"userType":\s*"anonymous"/.test(input.html)) {
    return { state: "expired", error: "hh answered anonymously" }
  }
  if (input.status === 403) return { state: "blocked", error: "hh answered 403" }
  if (input.status >= 400) return { state: "expired", error: `hh answered ${input.status}` }
  return { state: "ok", error: null }
}

export interface StoredCookie {
  readonly name: string
  readonly value: string
  readonly domain?: string
  readonly expires?: number
}

/** hh-cookies из Playwright storageState (JSON-текст из облака); `null`, если состояния нет или оно битое. */
export const readCookies = (stateJson: string | null): ReadonlyArray<StoredCookie> | null => {
  if (stateJson === null) return null
  try {
    const state = JSON.parse(stateJson) as { cookies?: StoredCookie[] }
    return (state.cookies ?? []).filter((c) => String(c.domain ?? "").includes("hh.ru"))
  } catch {
    return null
  }
}

export interface SessionCheck extends SessionVerdict {
  readonly name: HhProfileName
}

/** Fetches the hh profile page with the stored cookies; verdict and name come from one answer. */
export const checkProfileSession = async (stateJson: string | null): Promise<SessionCheck> => {
  const cookies = readCookies(stateJson)
  if (cookies === null) return { state: "expired", error: "no stored session", name: NO_NAME }
  const token = cookies.find((c) => c.name === "hhtoken" || c.name === "hhul")
  if (token?.expires !== undefined && token.expires > 0 && token.expires * 1000 < Date.now()) {
    return { state: "expired", error: "session cookie expired", name: NO_NAME }
  }
  try {
    const res = await fetch("https://hh.ru/applicant/profile/me", {
      headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "), "User-Agent": "Mozilla/5.0" },
      redirect: "follow"
    })
    const html = await res.text()
    const verdict = judgeSessionResponse({ status: res.status, url: res.url, html })
    return { ...verdict, name: verdict.state === "ok" ? parseProfileName(html) : NO_NAME }
  } catch (error) {
    return { state: "expired", error: `fetch failed: ${error}`, name: NO_NAME }
  }
}

export const formatLastOk = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 16).replace("T", " ") : "never"
