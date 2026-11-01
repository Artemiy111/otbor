import type { EmployerDraft, SalaryDraft, VacancyDraft } from "@otbor/contract"
import { Effect, Schema } from "effect"
import { HhParseError } from "./errors.ts"
import { decodeOnce, decodeEntities, htmlToText } from "./text.ts"
import { inferSeniority, resolveWorkFormats } from "./signals.ts"

/* -------------------------------------------------------------------------- */
/* The subset of InitialState that the corpus needs                           */
/* -------------------------------------------------------------------------- */

const HhId = Schema.Union([Schema.Number, Schema.String])

const HhLogo = Schema.Struct({
  type: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String))
})

const HhIndustry = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Number)),
  trl: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String))
})

const HhCompany = Schema.Struct({
  id: Schema.optional(Schema.NullOr(HhId)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  visibleName: Schema.optional(Schema.NullOr(Schema.String)),
  companySiteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logos: Schema.optional(Schema.NullOr(Schema.Array(HhLogo))),
  industries: Schema.optional(Schema.NullOr(Schema.Array(HhIndustry))),
  trusted: Schema.optional(Schema.NullOr(Schema.Boolean)),
  accreditedITEmployer: Schema.optional(Schema.NullOr(Schema.Boolean))
})

const HhArea = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Number)),
  name: Schema.optional(Schema.NullOr(Schema.String))
})

const HhCompensation = Schema.Struct({
  from: Schema.optional(Schema.NullOr(Schema.Number)),
  to: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  currencyCode: Schema.optional(Schema.NullOr(Schema.String)),
  gross: Schema.optional(Schema.NullOr(Schema.Boolean)),
  noCompensation: Schema.optional(Schema.NullOr(Schema.Boolean))
})

const HhStatus = Schema.Struct({
  archived: Schema.optional(Schema.NullOr(Schema.Boolean)),
  disabled: Schema.optional(Schema.NullOr(Schema.Boolean))
})

const HhVacancy = Schema.Struct({
  vacancyId: Schema.optional(Schema.NullOr(HhId)),
  id: Schema.optional(Schema.NullOr(HhId)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  keySkills: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  compensation: Schema.optional(Schema.NullOr(HhCompensation)),
  area: Schema.optional(Schema.NullOr(HhArea)),
  company: Schema.optional(Schema.NullOr(HhCompany)),
  workExperience: Schema.optional(Schema.NullOr(Schema.String)),
  employmentForm: Schema.optional(Schema.NullOr(Schema.String)),
  workFormats: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  publicationTimeIso: Schema.optional(Schema.NullOr(Schema.String)),
  lastChangeTimeIso: Schema.optional(Schema.NullOr(Schema.String)),
  validToTimeIso: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(HhStatus)),
  professionalRoles: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.NullOr(HhId)),
          name: Schema.optional(Schema.NullOr(Schema.String))
        })
      )
    )
  )
})

const ExtraVacancyFields = Schema.Struct({
  totalResponsesCount: Schema.optional(Schema.NullOr(Schema.Number)),
  vacancyResponsesCount: Schema.optional(Schema.NullOr(Schema.Number))
})

const HhInitialState = Schema.Struct({
  vacancyView: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        vacancyFull: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              vacancy: Schema.optional(Schema.NullOr(HhVacancy)),
              extraVacancyFields: Schema.optional(Schema.NullOr(ExtraVacancyFields))
            })
          )
        ),
        vacancy: Schema.optional(Schema.NullOr(HhVacancy))
      })
    )
  )
})

type HhInitialState = typeof HhInitialState.Type
type HhVacancy = typeof HhVacancy.Type
type HhCompany = typeof HhCompany.Type
type HhCompensation = typeof HhCompensation.Type

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

const TEMPLATE_RE =
  /<template[^>]*\bid=["']HH-Lux-InitialState["'][^>]*>([\s\S]*?)<\/template>/i

export const initialStatePayload = (html: string): string | null =>
  html.match(TEMPLATE_RE)?.[1] ?? null

const parseJson = (payload: string): Effect.Effect<unknown, HhParseError> =>
  Effect.suspend(() => {
    const text = payload.trim()
    if (text.length === 0) {
      return Effect.fail(
        new HhParseError({ code: "initial_state_invalid", message: "Initial state is empty" })
      )
    }

    try {
      return Effect.succeed(JSON.parse(text) as unknown)
    } catch {
      // Anonymous hh responses escape the whole JSON payload.
    }

    try {
      return Effect.succeed(JSON.parse(decodeEntities(text)) as unknown)
    } catch (error) {
      return Effect.fail(
        new HhParseError({
          code: "initial_state_invalid",
          message: error instanceof Error ? error.message : "Initial state is not valid JSON"
        })
      )
    }
  })

const asNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asString = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const asId = (value: number | string | null | undefined): string | null =>
  typeof value === "number" ? String(value) : asString(value)

const absoluteUrl = (value: string | null | undefined): string | null => {
  const text = asString(value)
  if (text === null) return null
  if (/^https?:\/\//i.test(text)) return text
  return `https://hh.ru${text.startsWith("/") ? "" : "/"}${text}`
}

const canonicalUrlFor = (externalId: string, url: string): string => {
  const match = url.match(/hh\.ru\/vacancy\/(\d+)/i)
  return `https://hh.ru/vacancy/${match?.[1] ?? externalId}`
}

const normalizeEmployer = (company: HhCompany | null | undefined): EmployerDraft | null => {
  if (company === null || company === undefined) return null
  const externalId = asId(company.id)
  const name = asString(company.visibleName) ?? asString(company.name)
  if (externalId === null || name === null) return null

  const logos = company.logos ?? []
  const logo =
    logos.find((item) => item.type === "vacancyPage") ??
    logos.find((item) => item.type === "ORIGINAL") ??
    logos[0]

  return {
    externalId,
    name,
    siteUrl: asString(company.companySiteUrl),
    logoUrl: absoluteUrl(logo?.url),
    industries: (company.industries ?? [])
      .map((industry) => asString(industry.trl) ?? asString(industry.name))
      .filter((industry): industry is string => industry !== null)
  }
}

const normalizeSalary = (
  compensation: HhCompensation | null | undefined
): SalaryDraft | null => {
  if (compensation === null || compensation === undefined) return null

  if (compensation.noCompensation === true) {
    return { from: null, to: null, currency: null, gross: null, negotiable: true }
  }

  const from = asNumber(compensation.from)
  const to = asNumber(compensation.to)
  if (from === null && to === null) return null

  return {
    from,
    to,
    currency: asString(compensation.currency) ?? asString(compensation.currencyCode),
    gross: typeof compensation.gross === "boolean" ? compensation.gross : null,
    negotiable: false
  }
}

const normalizeSkills = (skills: ReadonlyArray<string> | null | undefined): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const skill of skills ?? []) {
    if (typeof skill !== "string") continue
    const trimmed = skill.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

const vacancyFromState = (state: HhInitialState): HhVacancy | null => {
  const full = state.vacancyView?.vacancyFull?.vacancy
  if (full !== null && full !== undefined) return full
  return state.vacancyView?.vacancy ?? null
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface ExtractOptions {
  readonly url: string
  readonly fetchedAt?: string
}

export const extractFromState = (
  state: HhInitialState,
  options: ExtractOptions
): Effect.Effect<VacancyDraft, HhParseError> =>
  Effect.gen(function*() {
    const vacancy = vacancyFromState(state)
    const externalId = asId(vacancy?.vacancyId ?? vacancy?.id)
    const title = asString(vacancy?.name)

    if (vacancy === null || externalId === null) {
      return yield* new HhParseError({
        code: "vacancy_missing",
        message: "Initial state has no vacancyView.vacancyFull.vacancy payload"
      })
    }
    if (title === null) {
      return yield* new HhParseError({
        code: "vacancy_missing",
        message: "Vacancy has no title"
      })
    }

    const descriptionHtml =
      vacancy.description === null || vacancy.description === undefined
        ? null
        : decodeOnce(vacancy.description)
    const descriptionText = htmlToText(vacancy.description)
    const extra = state.vacancyView?.vacancyFull?.extraVacancyFields
    const salary = normalizeSalary(vacancy.compensation)

    return {
      source: "hh",
      externalId,
      canonicalUrl: canonicalUrlFor(externalId, options.url),
      url: options.url,
      title,
      employer: normalizeEmployer(vacancy.company),
      areaId: asNumber(vacancy.area?.id),
      areaName: asString(vacancy.area?.name),
      salary,
      experienceCode: asString(vacancy.workExperience),
      employmentForm: asString(vacancy.employmentForm),
      workFormats: resolveWorkFormats(vacancy.workFormats ?? [], descriptionText),
      seniority: inferSeniority(title, descriptionText),
      publishedAt: asString(vacancy.publicationTimeIso),
      archived: vacancy.status?.archived === true || vacancy.status?.disabled === true,
      descriptionHtml,
      descriptionText,
      skills: normalizeSkills(vacancy.keySkills),
      responsesTotal: asNumber(extra?.totalResponsesCount),
      responsesVacancy: asNumber(extra?.vacancyResponsesCount),
      raw: vacancy
    } satisfies VacancyDraft
  })

/**
 * Reads a vacancy from a saved hh.ru page.
 *
 * hh is a data source, not a DOM: the same function is used by the CLI over
 * fetched HTML, by fixtures in tests, and (via a live DOM adapter later) by the
 * extension. No browser globals leak into this package.
 */
export const extractVacancy = (
  html: string,
  options: ExtractOptions
): Effect.Effect<VacancyDraft, HhParseError> =>
  Effect.gen(function*() {
    const payload = initialStatePayload(html)
    if (payload === null) {
      if (/vacancy-description|HH-React-Root/i.test(html)) {
        return yield* new HhParseError({
          code: "initial_state_missing",
          message: "Page looks like hh.ru but has no HH-Lux-InitialState template"
        })
      }
      return yield* new HhParseError({
        code: "page_kind_unknown",
        message: "Not an hh.ru vacancy page"
      })
    }

    const json = yield* parseJson(payload)
    const state = yield* Schema.decodeUnknownEffect(HhInitialState)(json).pipe(
      Effect.mapError(
        (error) =>
          new HhParseError({
            code: "initial_state_invalid",
            message: error.message
          })
      )
    )

    return yield* extractFromState(state, options)
  })

export { HhInitialState }
