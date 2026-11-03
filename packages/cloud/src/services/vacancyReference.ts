/**
 * The external id behind an hh.ru vacancy reference: a plain number, or a URL
 * on hh.ru (or one of its subdomains / regional hosts) with `/vacancy/<id>`.
 * Anything else is not ours to fetch, so a pasted foreign URL never turns the
 * cloud into an open fetcher.
 */
const HH_HOST = /^(?:[a-z0-9-]+\.)*hh\.(?:ru|kz|uz|by|kg|az|ge)$/i

export const externalIdFromReference = (reference: string): string | null => {
  const ref = reference.trim()
  if (/^\d{3,}$/.test(ref)) return ref
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ? ref : `https://${ref}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (!HH_HOST.test(url.hostname)) return null
  return /^\/vacancy\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? null
}

/** The only URL the cloud ever requests for a manual fetch. */
export const vacancyPageUrl = (externalId: string): string => `https://hh.ru/vacancy/${externalId}`
