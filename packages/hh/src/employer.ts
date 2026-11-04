import { Effect, Schema } from "effect"
import { initialStatePayload } from "./extract.ts"
import { HhParseError } from "./errors.ts"
import { decodeEntities, htmlToText } from "./text.ts"

/**
 * hh employer pages carry their data in the same `HH-Lux-InitialState`
 * template as vacancy pages, with an `employerView`/`company` shape that
 * changes between releases. Instead of pinning the whole shape, this parser
 * walks the JSON for the employer node and reads the fields the corpus keeps.
 * A page with none of them is a parse error, not a silent empty update.
 */

export interface EmployerProfileDraft {
  readonly externalId: string
  readonly name: string | null
  readonly rating: number | null
  readonly reviewsCount: number | null
  readonly recommendationsPercent: number | null
  readonly siteUrl: string | null
  readonly logoUrl: string | null
  readonly industries: ReadonlyArray<string>
  /** `company`, `agency`, `private_recruiter`... as hh names the employer kind. */
  readonly category: string | null
  readonly sizeCategory: string | null
  readonly address: string | null
  readonly siteHost: string | null
  /** The "about the company" text, tags stripped. */
  readonly descriptionText: string | null
  readonly badges: ReadonlyArray<EmployerBadge>
  readonly trusted: boolean | null
  readonly accreditedIt: boolean | null
  readonly activeVacancies: number | null
}

export interface EmployerBadge {
  readonly type: string | null
  readonly description: string | null
  readonly url: string | null
  readonly year: number | null
}

export interface ExtractEmployerOptions {
  readonly externalId?: string
  readonly url?: string
}

type Json = unknown

const asRecord = (value: Json): Record<string, Json> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null

const asString = (value: Json): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const asBoolean = (value: Json): boolean | null => (typeof value === "boolean" ? value : null)

const asNumber = (value: Json): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."))
    return Number.isFinite(parsed) ? parsed : null
  }
  const record = asRecord(value)
  return record === null ? null : asNumber(record.value ?? record.rating)
}

const absoluteUrl = (value: Json): string | null => {
  const raw = asString(value)
  if (raw === null) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith("//")) return `https:${raw}`
  if (raw.startsWith("/")) return `https://hh.ru${raw}`
  return null
}

const nodeId = (record: Record<string, Json>): string | null =>
  asString(record.id) ?? asString(record.employerId) ?? asString(record.companyId)

interface Candidate {
  readonly record: Record<string, Json>
  readonly matchedId: boolean
}

const collectCandidates = (value: Json, externalId: string | null, out: Candidate[]): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, externalId, out)
    return
  }
  const record = asRecord(value)
  if (record === null) return

  const id = nodeId(record)
  const looksLikeEmployer =
    "companySiteUrl" in record ||
    "industries" in record ||
    "logos" in record ||
    "logoUrls" in record ||
    "employerRating" in record ||
    "aggregateRating" in record ||
    "reviewsCount" in record
  if (looksLikeEmployer) {
    out.push({
      record,
      matchedId: id !== null && externalId !== null && id === externalId
    })
  }

  for (const nested of Object.values(record)) {
    collectCandidates(nested, externalId, out)
  }
}

const industriesOf = (record: Record<string, Json>): string[] => {
  const raw = record.industries ?? record.industry
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return list
    .map((item) => {
      if (typeof item === "string") return item.trim()
      const node = asRecord(item)
      return node === null ? null : asString(node.trl) ?? asString(node.name)
    })
    .filter((item): item is string => item !== null && item !== "")
}

const logoOf = (record: Record<string, Json>): string | null => {
  const raw = record.logos ?? record.logoUrls ?? record.logo
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  for (const item of list) {
    const url = absoluteUrl(item) ?? absoluteUrl(asRecord(item)?.url)
    if (url !== null) return url
  }
  return absoluteUrl(record.logoUrl)
}

const nameOf = (record: Record<string, Json>): string | null =>
  asString(record.visibleName) ??
  asString(record.name) ??
  asString(record.companyName) ??
  asString(record.brandName)

const siteOf = (record: Record<string, Json>): string | null =>
  absoluteUrl(record.companySiteUrl) ??
  absoluteUrl(record.siteUrl) ??
  absoluteUrl(record.websiteUrl)

const mergeCandidate = (
  draft: EmployerProfileDraft,
  candidate: Candidate
): EmployerProfileDraft => {
  const record = candidate.record
  const industries = industriesOf(record)
  const aggregate = asRecord(record.aggregateRating)
  return {
    ...draft,
    name: draft.name ?? nameOf(record),
    rating:
      draft.rating ??
      (aggregate === null ? null : asNumber(aggregate.ratingValue)) ??
      asNumber(record.rating) ??
      asNumber(record.employerRating) ??
      asNumber(record.ratingSummary),
    reviewsCount:
      draft.reviewsCount ??
      (aggregate === null ? null : asNumber(aggregate.ratingCount) ?? asNumber(aggregate.reviewCount)) ??
      asNumber(record.reviewsCount) ??
      asNumber(record.reviews),
    recommendationsPercent:
      draft.recommendationsPercent ??
      asNumber(record.recommendationsPercent) ??
      asNumber(record.recommendations),
    siteUrl: draft.siteUrl ?? siteOf(record),
    logoUrl: draft.logoUrl ?? logoOf(record),
    industries: draft.industries.length > 0 ? draft.industries : industries
  }
}

const badgesOf = (value: Json): EmployerBadge[] => {
  const node = asRecord(value)
  const list = Array.isArray(value) ? value : Array.isArray(node?.badge) ? node.badge : []
  return list.flatMap((item) => {
    const badge = asRecord(item)
    if (badge === null) return []
    return [{
      type: asString(badge.type) ?? asString(badge["@type"]),
      description: asString(badge.description),
      url: asString(badge.url) ?? asString(badge["@url"]),
      year: asNumber(badge.year)
    }]
  })
}

/**
 * hh double-escapes the description inside the state JSON (`&lt;p&gt;`), so a
 * string without a tag but with `&lt;` is decoded once to real HTML.
 */
const descriptionHtmlOf = (value: Json): string | null => {
  const raw = asString(value)
  if (raw === null) return null
  const html = !raw.includes("<") && raw.includes("&lt;") ? decodeEntities(raw) : raw
  return html.trim() === "" ? null : html
}

/**
 * The real page shape: `employerInfo` (profile), `employerOrganizationSchema`
 * (rating, logo, site), `employerLogo`, `activeEmployerVacancyCount`. Returns
 * null when the state has none of it so the heuristic walk can take over.
 */
const fromEmployerState = (
  state: Record<string, Json>,
  externalId: string
): EmployerProfileDraft | null => {
  const info = asRecord(state.employerInfo)
  if (info === null) return null
  const organization = asRecord(state.employerOrganizationSchema)
  const aggregate = asRecord(organization?.aggregateRating)
  const site = asRecord(info.site)
  const descriptionHtml = descriptionHtmlOf(info.description)
  const descriptionText = descriptionHtml === null ? null : htmlToText(descriptionHtml) || null

  return {
    externalId: asString(info.id) ?? externalId,
    name: asString(info.name) ?? asString(organization?.name),
    rating: aggregate === null ? null : asNumber(aggregate.ratingValue),
    reviewsCount: aggregate === null ? null : asNumber(aggregate.ratingCount),
    recommendationsPercent: null,
    siteUrl: absoluteUrl(site?.href) ?? absoluteUrl(organization?.siteUrl),
    logoUrl: absoluteUrl(organization?.logoUrl) ?? absoluteUrl(asRecord(state.employerLogo)?.logoUrl),
    industries: industriesOf(info),
    category: asString(info.category),
    sizeCategory: asString(info.sizeCategory),
    address: asString(info.address),
    siteHost: asString(site?.hostname),
    descriptionText,
    badges: badgesOf(info.badges),
    trusted: asBoolean(info.isTrusted),
    accreditedIt: asBoolean(info.accreditedITEmployer),
    activeVacancies: asNumber(state.activeEmployerVacancyCount),
  }
}

const JSON_LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

const fromJsonLd = (html: string, externalId: string | null): EmployerProfileDraft[] => {
  const drafts: EmployerProfileDraft[] = []
  for (const match of html.matchAll(JSON_LD)) {
    let parsed: Json
    try {
      parsed = JSON.parse(match[1] ?? "")
    } catch {
      continue
    }
    const list = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of list) {
      const record = asRecord(item)
      if (record === null) continue
      const types = record["@type"]
      const typeList = Array.isArray(types) ? types : [types]
      const isOrganization = typeList.some(
        (type) => typeof type === "string" && /organization|employer/i.test(type)
      )
      if (!isOrganization) continue

      const aggregate = asRecord(record.aggregateRating)
      const logo = asRecord(record.logo)
      drafts.push({
        externalId: externalId ?? "",
        name: asString(record.name),
        rating: aggregate === null ? null : asNumber(aggregate.ratingValue),
        reviewsCount: aggregate === null ? null : asNumber(aggregate.ratingCount) ?? asNumber(aggregate.reviewCount),
        recommendationsPercent: null,
        siteUrl: absoluteUrl(record.url),
        logoUrl: absoluteUrl(record.logo) ?? absoluteUrl(logo?.url),
        industries: industriesOf(record),
        ...EMPTY_PROFILE
      })
    }
  }
  return drafts
}

const EMPTY_PROFILE = {
  category: null,
  sizeCategory: null,
  address: null,
  siteHost: null,
  descriptionText: null,
  badges: [],
  trusted: null,
  accreditedIt: null,
  activeVacancies: null,
} as const

const emptyDraft = (externalId: string): EmployerProfileDraft => ({
  externalId,
  name: null,
  rating: null,
  reviewsCount: null,
  recommendationsPercent: null,
  siteUrl: null,
  logoUrl: null,
  industries: [],
  ...EMPTY_PROFILE
})

const hasData = (draft: EmployerProfileDraft): boolean =>
  draft.name !== null ||
  draft.rating !== null ||
  draft.reviewsCount !== null ||
  draft.recommendationsPercent !== null ||
  draft.siteUrl !== null ||
  draft.logoUrl !== null ||
  draft.industries.length > 0 ||
  draft.descriptionText !== null

/**
 * Reads profile fields from an employer page. Tolerates unknown state shapes:
 * the id match is preferred, JSON-LD is the fallback, and a page with neither
 * fails with `employer_missing` so the schedule records `last_error`.
 */
export const extractEmployer = (
  html: string,
  options: ExtractEmployerOptions = {}
): Effect.Effect<EmployerProfileDraft, HhParseError> =>
  Effect.gen(function*() {
    const externalId = options.externalId ?? ""

    const payload = initialStatePayload(html)
    if (payload !== null) {
      let json: Json
      try {
        json = JSON.parse(payload.replace(/&#34;/g, '"').replace(/&quot;/g, '"'))
      } catch {
        json = null
      }

      const state = asRecord(json)
      const real = state === null ? null : fromEmployerState(state, externalId)
      if (real !== null && hasData(real)) return real

      if (json !== null) {
        const candidates: Candidate[] = []
        collectCandidates(json, externalId === "" ? null : externalId, candidates)
        const preferred = candidates.filter((candidate) => candidate.matchedId)
        const ordered = preferred.length > 0 ? preferred : candidates

        let draft = emptyDraft(externalId)
        for (const candidate of ordered) draft = mergeCandidate(draft, candidate)
        if (hasData(draft)) return draft
      }
    }

    for (const draft of fromJsonLd(html, externalId === "" ? null : externalId)) {
      if (hasData(draft)) return draft
    }

    return yield* new HhParseError({
      code: "employer_missing",
      message: "Employer page has no recognizable profile fields"
    })
  })

/** Kept for symmetry with the vacancy schema module; not decoded here. */
export const EmployerProfile = Schema.Struct({
  externalId: Schema.String,
  name: Schema.NullOr(Schema.String),
  rating: Schema.NullOr(Schema.Number),
  reviewsCount: Schema.NullOr(Schema.Int),
  recommendationsPercent: Schema.NullOr(Schema.Int),
  siteUrl: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
  industries: Schema.Array(Schema.String),
  descriptionText: Schema.NullOr(Schema.String)
})

export interface EmployerReviewsWidget {
  readonly rating: number | null
  readonly reviewsCount: number | null
  readonly recommendationsPercent: number | null
}

export const employerReviewsWidgetUrl = (employerId: string, vacancyId?: string): string => {
  const url = new URL("https://hh.ru/employer_reviews/proxy_components/small_widget")
  url.searchParams.set("employerId", employerId)
  if (vacancyId !== undefined) url.searchParams.set("vacancyId", vacancyId)
  url.searchParams.set("is_magritte", "True")
  url.searchParams.set("is_on_employer_page", "False")
  return url.toString()
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  amp: "&",
  apos: "'"
}

/** One pass, so `&amp;quot;` is not decoded twice. Covers `&#92;` (backslash) and `&#34;`. */
const decodeHtml = (value: string): string =>
  value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (whole, dec, hex, name) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec))
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16))
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? whole
  })

const fromReviews = (node: Json): EmployerReviewsWidget | null => {
  const reviews = asRecord(asRecord(node)?.employerReviews)
  if (reviews === null) return null
  return {
    rating: asNumber(reviews.totalRating),
    reviewsCount: asNumber(reviews.reviewsCount),
    recommendationsPercent: asNumber(reviews.recommendationsPercent)
  }
}

/**
 * hh's small reviews widget: JSON (`employerReviews`) or an HTML shell with the
 * same state in `EmployerReviewsFront-InitialState`. Null when neither is found.
 */
export const parseEmployerReviewsWidget = (body: string): EmployerReviewsWidget | null => {
  const text = body.trim()
  if (text.startsWith("{")) {
    try {
      return fromReviews(JSON.parse(text))
    } catch {
      return null
    }
  }
  const match = text.match(
    /<template[^>]*class="[^"]*EmployerReviewsFront-InitialState[^"]*"[^>]*>([\s\S]*?)<\/template>/
  )
  if (match?.[1] === undefined) return null
  try {
    return fromReviews(JSON.parse(decodeHtml(match[1])))
  } catch {
    return null
  }
}
