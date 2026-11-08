import { normalizeSearchUrl } from "@otbor/contract"
import { decodeEntities, initialStatePayload } from "@otbor/hh"
import { CrawlerError } from "./errors.ts"

export { normalizeSearchUrl }

/**
 * Browser-independent parser for hh.ru search results.
 *
 * hh renders the result list server-side into `HH-Lux-InitialState` under
 * `vacancySearchResult`. A card is enough for a stub: id, title, company,
 * salary, area, publication date and snippet. Full text is fetched later.
 */

export interface SearchCard {
  readonly externalId: string
  readonly title: string
  readonly url: string
  readonly companyExternalId: string | null
  readonly companyName: string | null
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly salaryGross: boolean | null
  readonly salaryNegotiable: boolean
  readonly areaId: number | null
  readonly areaName: string | null
  readonly publishedAt: string | null
  readonly snippet: string | null
  readonly experienceCode: string | null
  readonly employmentForm: string | null
  readonly workFormats: ReadonlyArray<string>
  readonly workScheduleDays: ReadonlyArray<string>
  readonly workingHours: ReadonlyArray<string>
  readonly archived: boolean
}

export interface SearchCriteria {
  readonly text: string | null
  readonly area: ReadonlyArray<number>
  readonly page: number
  readonly itemsOnPage: number
  readonly orderBy: string | null
  readonly searchField: ReadonlyArray<string>
}

export interface SearchPage {
  readonly page: number
  readonly totalResults: number
  readonly pagesTotal: number
  readonly hasNext: boolean
  readonly cards: ReadonlyArray<SearchCard>
  readonly criteria: SearchCriteria
}

export type CrawlBlock = "captcha" | "auth" | "forbidden" | "geo"

const CAPTCHA_RE =
  /captcha\.hh\.ru|подтвердите, что вы не робот|введите символы с картинки|доступ ограничен/i
const AUTH_RE = /войдите с паролем|вход и регистрация|войти с помощью|укажите телефон/i

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

const asStringArray = (value: unknown): ReadonlyArray<string> => {
  const result: string[] = []
  for (const item of asArray(value)) {
    if (typeof item === "string" && item.trim() !== "") result.push(item.trim())
  }
  return result
}

/** hh.ru never serves search results deeper than this many items per query. */
const HH_MAX_RESULTS_DEPTH = 2000

/** Parses either a whole `HH-Lux-InitialState` state or `vacancySearchResult`. */
export const parseSearchPage = (state: unknown): SearchPage => {
  const root = asRecord(state)
  const result = asRecord(root?.vacancySearchResult) ?? root
  const vacancies = asArray(result?.vacancies)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null)

  if (!result || !Array.isArray(result.vacancies)) {
    throw new CrawlerError({
      code: "search_state_missing",
      message: "В состоянии страницы нет vacancySearchResult.vacancies"
    })
  }

  const criteria = asRecord(result.criteria) ?? {}
  const page = asNumber(criteria.page) ?? 0
  const itemsOnPage = asNumber(criteria.items_on_page) ?? Math.max(vacancies.length, 1)
  const totalResults = asNumber(result.totalResults) ?? vacancies.length
  const paging = asRecord(result.paging)
  const lastPage = asNumber(asRecord(paging?.lastPage)?.page)
  const next = asRecord(paging?.next)

  // hh is the authority on how deep the result list goes (it caps it at 2000
  // items whatever `totalResults` says). When it ships a `next` control, that
  // control decides: disabled means this is the last page.
  const nextPage = next === null ? null : asNumber(next.page)
  const hasNext =
    nextPage !== null
      ? next?.disabled !== true
      : lastPage !== null
      ? lastPage > page
      : page + 1 < Math.ceil(totalResults / Math.max(itemsOnPage, 1)) && totalResults > 0

  const pagesTotal = hasNext
    ? lastPage !== null
      ? lastPage + 1
      : Math.max(
        page + 2,
        Math.ceil(Math.min(totalResults, HH_MAX_RESULTS_DEPTH) / Math.max(itemsOnPage, 1))
      )
    : page + 1

  return {
    page,
    totalResults,
    pagesTotal,
    hasNext,
    cards: parseCards(vacancies),
    criteria: {
      text: asString(criteria.text),
      area: asArray(criteria.area).flatMap((item) => {
        const value = asNumber(item)
        return value === null ? [] : [value]
      }),
      page,
      itemsOnPage,
      orderBy: asString(criteria.order_by),
      searchField: asStringArray(criteria.search_field)
    }
  }
}

const parseCards = (records: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<SearchCard> => {
  const seen = new Set<string>()
  const cards: SearchCard[] = []

  for (const record of records) {
    const card = parseCard(record)
    if (card === null || seen.has(card.externalId)) continue
    seen.add(card.externalId)
    cards.push(card)
  }

  return cards
}

const parseCard = (record: Record<string, unknown>): SearchCard | null => {
  const externalId = asString(String(record.vacancyId ?? ""))
  if (externalId === null || !/^\d+$/.test(externalId)) return null

  const title = asString(record.name)
  if (title === null) return null

  const company = asRecord(record.company)
  const links = asRecord(record.links)
  const compensation = asRecord(record.compensation)
  const noCompensation = compensation !== null && Boolean(compensation.noCompensation)
  const area = asRecord(record.area)
  const publication = asRecord(record.publicationTime)

  return {
    externalId,
    title,
    url: asString(links?.desktop) ?? `https://hh.ru/vacancy/${externalId}`,
    companyExternalId: company?.id !== undefined && company.id !== null
      ? String(company.id)
      : null,
    companyName: asString(company?.visibleName) ?? asString(company?.name),
    salaryFrom: noCompensation ? null : asNumber(compensation?.from),
    salaryTo: noCompensation ? null : asNumber(compensation?.to),
    salaryCurrency: noCompensation
      ? null
      : asString(compensation?.currencyCode) ?? asString(compensation?.currency),
    salaryGross: noCompensation ? null : asBoolean(compensation?.gross),
    salaryNegotiable: noCompensation,
    areaId: asNumber(area?.["@id"] ?? area?.id),
    areaName: asString(area?.name),
    publishedAt: publicationIso(publication),
    snippet: snippetText(record.snippet),
    experienceCode: asString(record.workExperience),
    employmentForm: asString(record.employmentForm),
    workFormats: flattenFormats(record.workFormats, "workFormatsElement"),
    workScheduleDays: flattenFormats(record.workScheduleByDays, "workScheduleByDaysElement"),
    workingHours: flattenFormats(record.workingHours, "workingHoursElement"),
    archived: record.closedForApplicants === true || asBoolean(record.archived) === true
  }
}

const publicationIso = (publication: Record<string, unknown> | null): string | null => {
  if (publication === null) return null
  const iso = asString(publication.$)
  if (iso !== null) return iso

  const timestamp = asNumber(publication["@timestamp"])
  if (timestamp === null) return null
  return new Date(timestamp * 1000).toISOString()
}

const snippetText = (value: unknown): string | null => {
  if (typeof value === "string") return asString(value)
  const record = asRecord(value)
  if (record === null) return null
  const parts = [
    asString(record.requirement),
    asString(record.responsibility),
    asString(record.req),
    asString(record.resp)
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join("\n") : null
}

const flattenFormats = (value: unknown, elementKey: string): ReadonlyArray<string> => {
  const result: string[] = []
  for (const item of asArray(value)) {
    if (typeof item === "string") {
      result.push(item)
      continue
    }
    const record = asRecord(item)
    if (record === null) continue
    for (const nested of asArray(record[elementKey] ?? record.element ?? record.value)) {
      if (typeof nested === "string") result.push(nested)
    }
  }
  return [...new Set(result)]
}

const parseInitialStateText = (raw: string): unknown => {
  const text = raw.trim()
  if (text.length === 0) {
    throw new CrawlerError({
      code: "search_state_invalid",
      message: "Initial state is empty"
    })
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    // Anonymous hh responses escape the whole JSON payload.
  }

  try {
    return JSON.parse(decodeEntities(text)) as unknown
  } catch (error) {
    throw new CrawlerError({
      code: "search_state_invalid",
      message: error instanceof Error ? error.message : "Initial state is not valid JSON"
    })
  }
}

/** Extracts `HH-Lux-InitialState` from fetched HTML and parses the search page. */
export const parseSearchHtml = (html: string): SearchPage => {
  const payload = initialStatePayload(html)
  if (payload === null) {
    const block = classifyCrawlBlock(200, html)
    if (block === "captcha") {
      throw new CrawlerError({
        code: "search_blocked_captcha",
        message: "hh.ru показал капчу вместо результатов поиска"
      })
    }
    if (block === "auth") {
      throw new CrawlerError({
        code: "search_blocked_auth",
        message: "hh.ru требует вход вместо результатов поиска"
      })
    }
    if (block === "forbidden") {
      throw new CrawlerError({
        code: "search_blocked_forbidden",
        message: "hh.ru вернул 403"
      })
    }
    if (block === "geo") {
      throw new CrawlerError({
        code: "search_blocked_geo",
        message: "hh.ru недоступен с этого IP (451)"
      })
    }
    throw new CrawlerError({
      code: "search_state_missing",
      message: "На странице поиска нет HH-Lux-InitialState"
    })
  }

  return parseSearchPage(parseInitialStateText(payload))
}

export const classifyCrawlBlock = (status: number, html: string): CrawlBlock | null => {
  if (status === 403) return "forbidden"
  // 451 = unavailable for legal reasons: hh blocks whole IP ranges by country.
  if (status === 451) return "geo"

  // Anonymous hh pages still render a login link in the header. If the SSR
  // state is present, we have real content and must not treat it as a wall.
  const hasState = /id=["']HH-Lux-InitialState["']/i.test(html)
  if (hasState) return null

  if (CAPTCHA_RE.test(html)) return "captcha"
  if (AUTH_RE.test(html)) return "auth"
  return null
}

export const withPageParam = (input: string, page: number): string => {
  try {
    const url = new URL(input)
    url.searchParams.set("page", String(page))
    return url.toString()
  } catch {
    return input
  }
}
