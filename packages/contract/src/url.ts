/**
 * Pure URL helpers shared by the crawler and the cloud.
 *
 * A saved search is identified by its normalized URL, not by the exact link an
 * operator pasted. Paging, session and referral parameters are noise: dropping
 * them here means `search_query` has one row per real search and a resumed run
 * lands on the same query.
 */

const VOLATILE_PARAMS = new Set([
  "page",
  "search_session_id",
  "hhtmFrom",
  "hhtmFromLabel",
  "from",
  "src",
  "source",
  "redirect"
])

/** Escapes characters that must not change the meaning of a query in a link. */
const escapeDisplayParam = (value: string): string =>
  value
    .replace(/%/g, "%25")
    .replace(/&/g, "%26")
    .replace(/=/g, "%3D")
    .replace(/\+/g, "%2B")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")
    .replace(/ /g, "%20")

/**
 * Human-readable URL for the same normalized identity: Cyrillic and spaces are
 * legible, while reserved query characters stay escaped so the link is safe to
 * click and round-trips to the same URL.
 */
export const formatSearchUrl = (input: string): string => {
  try {
    const url = new URL(input)
    const query = [...url.searchParams.entries()]
      .map(([key, value]) => `${escapeDisplayParam(key)}=${escapeDisplayParam(value)}`)
      .join("&")
    return `${url.origin}${url.pathname}${query === "" ? "" : `?${query}`}`
  } catch {
    return input.trim()
  }
}

/** Stable identity of a saved search: drops paging and session noise. */
export const normalizeSearchUrl = (input: string): string => {
  try {
    const url = new URL(input)
    url.hostname = url.hostname.replace(/^www\./, "").replace(/^m\./, "")
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (VOLATILE_PARAMS.has(key)) url.searchParams.delete(key)
    }
    const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    url.search = ""
    for (const [key, value] of entries) url.searchParams.append(key, value)
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1)
    }
    return url.toString()
  } catch {
    return input.trim()
  }
}

/** The `text` parameter of a search URL, used as a human label for the query. */
export const searchTextFromUrl = (input: string): string | null => {
  try {
    const text = new URL(input).searchParams.get("text")?.trim() ?? ""
    return text === "" ? null : text
  } catch {
    return null
  }
}
