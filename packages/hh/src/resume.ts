import { readInitialState } from "./negotiations.ts"
import { decodeEntities, htmlToText } from "./text.ts"

/**
 * Pure readers of the applicant's resume pages.
 *
 * - the profile page (`/applicant/profile/me`) lists resume cards, each with a
 *   hash (`data-qa="resume"` + a `/resume/<hash>` link);
 * - a resume page (`/resume/<hash>`) ships the resume as
 *   `applicantResume` in the `HH-Lux-InitialState` template.
 *
 * The browser harness only fetches pages; the cloud runs these on the
 * evidence. A page that cannot be read is `null`, never an empty resume.
 * hh uses Magritte: scalars arrive as `[{ string: "..." }]`, numbers as
 * numbers or numeric strings, so every reader accepts both forms.
 */

export interface ResumeRef {
  readonly hash: string
  readonly title: string
}

export interface ResumeExperienceItem {
  readonly companyName: string | null
  readonly position: string | null
  readonly startDate: string | null
  readonly endDate: string | null
  readonly description: string
}

export interface ResumeEducationItem {
  readonly name: string
  readonly organization: string | null
  readonly result: string | null
  readonly year: number | null
}

export interface ParsedResume {
  readonly externalId: string
  readonly hash: string
  readonly title: string
  /** The full resume as plain text: about, experience, education, certificates. */
  readonly text: string
  /** The applicant's "about me" block. */
  readonly about: string
  readonly skills: ReadonlyArray<string>
  readonly experience: ReadonlyArray<ResumeExperienceItem>
  readonly education: ReadonlyArray<ResumeEducationItem>
  readonly workFormats: ReadonlyArray<string>
  readonly salaryAmount: number | null
  readonly salaryCurrency: string | null
  readonly status: string | null
  readonly areaName: string | null
  /** hh codes as stated in the resume, e.g. `no_relocation`, `sometimes`. */
  readonly relocation: string | null
  readonly businessTripReadiness: string | null
  readonly travelTime: string | null
  /** The English level from the resume's language block, e.g. `B2`; null when not stated. */
  readonly englishLevel: string | null
  readonly professionalRole: string | null
  readonly updatedAt: string | null
}

/* -------------------------------------------------------------------------- */
/* Value readers                                                              */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, unknown>

const objectOf = (value: unknown): Obj | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null

const plain = (value: string): string => htmlToText(value).replace(/\s+/g, " ").trim()

const readString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
  }
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const read = readString(item)
      if (read !== null) return read
    }
    return null
  }
  const object = objectOf(value)
  if (object === null) return null
  return (
    readString(object.string) ??
    readString(object.name) ??
    readString(object.text) ??
    readString(object.value) ??
    readString(object.dateTime)
  )
}

const readStrings = (value: unknown): ReadonlyArray<string> => {
  if (value === null || value === undefined) return []
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()]
  if (Array.isArray(value)) return value.flatMap(readStrings)
  const read = readString(value)
  return read === null ? [] : [read]
}

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const object = objectOf(value)
  return object === null ? null : readNumber(object.value) ?? readNumber(object.string)
}

const toIso = (value: unknown): string | null => {
  let date: Date | null = null
  if (typeof value === "number" && Number.isFinite(value)) date = new Date(value)
  else if (typeof value === "string" && value.trim() !== "") date = new Date(value)
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim()
    const key = trimmed.toLowerCase()
    if (trimmed === "" || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

const objects = (value: unknown): ReadonlyArray<Obj> =>
  Array.isArray(value) ? value.map(objectOf).filter((item): item is Obj => item !== null) : []

/* -------------------------------------------------------------------------- */
/* Profile page: resume cards                                                 */
/* -------------------------------------------------------------------------- */

const CARD_RE = /<div[^>]*\bdata-qa=["']resume["'][^>]*>/gi
const LINK_RE = /href=["'][^"']*\/resume\/([0-9a-f]{16,})/i
const LINK_QA_RE = /data-qa=["']resume-card-link-([0-9a-f]{16,})["']/i
const HASH_RE = /^[0-9a-f]{16,}$/i

const attr = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? null

/** The resume cards on the profile page, deduplicated by hash. */
export const parseResumeRefs = (html: string): ReadonlyArray<ResumeRef> => {
  const refs: Array<ResumeRef> = []
  const seen = new Set<string>()
  for (const match of html.matchAll(CARD_RE)) {
    const start = match.index ?? 0
    const chunk = html.slice(start, start + 20_000)
    const id = attr(match[0], "data-qa-id")
    const title = decodeEntities(attr(match[0], "data-qa-title") ?? "").trim()
    const hash =
      chunk.match(LINK_QA_RE)?.[1] ?? chunk.match(LINK_RE)?.[1] ?? (id !== null && HASH_RE.test(id) ? id : null)
    if (hash === null || seen.has(hash)) continue
    seen.add(hash)
    refs.push({ hash, title: title === "" ? "Резюме" : title })
  }
  return refs
}

/**
 * The profile evidence: each resume card's opening tag and the markup after
 * it, without the rest of the page. A logged-in profile is over 1 MB and the
 * cards sit deep inside it, so a plain prefix would miss them.
 */
export const resumeCardsFragment = (html: string, chunk = 6_000): string => {
  const parts: Array<string> = []
  for (const match of html.matchAll(CARD_RE)) {
    const start = match.index ?? 0
    parts.push(html.slice(start, start + chunk))
  }
  return parts.join("\n")
}

/* -------------------------------------------------------------------------- */
/* Resume page                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The resume evidence of a page: a template holding only `applicantResume`.
 * The whole initial state is far larger than needed; falls back to `null`
 * when the state is missing so the caller keeps the page as it is.
 */
export const resumeStateFragment = (html: string, max = 400_000): string | null => {
  const state = readInitialState(html)
  const resume = state?.applicantResume
  if (resume === undefined || resume === null) return null
  const json = JSON.stringify({ applicantResume: resume, hhid: state?.hhid }).replace(/</g, "\\u003c")
  const fragment = `<template id="HH-Lux-InitialState">${json}</template>`
  return fragment.length <= max ? fragment : null
}

const readExperience = (value: unknown): ReadonlyArray<ResumeExperienceItem> =>
  objects(value)
    .map((item) => ({
      companyName: readString(item.companyName),
      position: readString(item.position),
      startDate: readString(item.startDate),
      endDate: readString(item.endDate),
      description: plain(readString(item.description) ?? "")
    }))
    .filter((item) => item.companyName !== null || item.position !== null || item.description !== "")

const readEducation = (value: unknown): ReadonlyArray<ResumeEducationItem> =>
  objects(value)
    .map((item) => ({
      name: readString(item.name) ?? readString(item.string) ?? "",
      organization: readString(item.organization),
      result: readString(item.result),
      year: readNumber(item.year)
    }))
    .filter((item) => item.name !== "")

const readNamed = (value: unknown): ReadonlyArray<string> =>
  objects(value)
    .map((item) => readString(item.name) ?? readString(item.title) ?? readString(item.string) ?? "")
    .filter((name) => name !== "")

const namedSkills = (value: unknown, category?: string): ReadonlyArray<string> =>
  objects(value)
    .filter((item) => category === undefined || readString(item.category) === category)
    .map((item) => readString(item.name))
    .filter((name): name is string => name !== null)

const collectSkills = (resume: Obj): ReadonlyArray<string> =>
  unique([
    ...namedSkills(resume.advancedKeySkills),
    ...readStrings(resume.keySkills),
    ...namedSkills(resume.resumeApplicantSkills, "SKILL"),
    ...namedSkills(resume.verifiedSkills, "SKILL")
  ])

const salaryOf = (value: unknown): Obj | null => (Array.isArray(value) ? objectOf(value[0]) : objectOf(value))

/** The text the model reads: every block of the resume, labelled. */
const renderText = (parts: {
  readonly title: string
  readonly about: string
  readonly experience: ReadonlyArray<ResumeExperienceItem>
  readonly education: ReadonlyArray<ResumeEducationItem>
  readonly certificates: ReadonlyArray<string>
}): string => {
  const blocks: Array<string> = []
  if (parts.about !== "") blocks.push(`О себе:\n${parts.about}`)
  if (parts.experience.length > 0) {
    blocks.push(
      "Опыт работы:\n" +
        parts.experience
          .map((item) => {
            const head = [item.position, item.companyName].filter(Boolean).join(" — ")
            const period = item.startDate !== null || item.endDate !== null
              ? `${item.startDate ?? "?"} — ${item.endDate ?? "по настоящее время"}`
              : ""
            return [head, period, item.description].filter((line) => line !== "").join("\n")
          })
          .join("\n\n")
    )
  }
  if (parts.education.length > 0) {
    blocks.push(
      "Образование:\n" +
        parts.education
          .map((item) =>
            [item.name, item.organization, item.result, item.year === null ? null : String(item.year)]
              .filter(Boolean)
              .join(" · ")
          )
          .join("\n")
    )
  }
  if (parts.certificates.length > 0) blocks.push(`Сертификаты:\n${parts.certificates.join("\n")}`)
  return blocks.join("\n\n")
}

/** hh's id of English in the resume's language block (34 is Russian). */
const HH_ENGLISH_ID = 57

/**
 * The English entry of the resume's language block. hh sends
 * `language: [{ id: 57, degree: "c1" }]`: a language id and a degree that is a
 * CEFR level (`a1`..`c2`) or `l1` for a native speaker.
 */
const readEnglishLevel = (language: unknown): string | null => {
  if (!Array.isArray(language)) return null
  for (const item of language) {
    const entry = objectOf(item)
    if (entry === null || Number(entry.id) !== HH_ENGLISH_ID) continue
    const degree = readString(entry.degree)?.toLowerCase()
    if (degree === undefined || degree === null) return null
    if (degree === "l1") return "родной"
    return /^[abc][12]$/.test(degree) ? degree.toUpperCase() : null
  }
  return null
}

/** Parses one resume page. `null` when the page holds no readable resume. */
export const parseResumePage = (html: string): ParsedResume | null => {
  const state = readInitialState(html)
  const resume = objectOf(state?.applicantResume)
  const attributes = objectOf(resume?._attributes)
  if (resume === null || attributes === null) return null
  const hash = readString(attributes.hash)
  const id = readString(attributes.id)
  if (hash === null || id === null) return null

  const title = readString(resume.title) ?? "Резюме"
  const about = readStrings(resume.skills).map(plain).filter((line) => line !== "").join("\n\n")
  const experience = readExperience(resume.experience)
  const education = [
    ...readEducation(resume.primaryEducation),
    ...readEducation(resume.additionalEducation),
    ...readEducation(resume.attestationEducation)
  ]
  const certificates = [...readNamed(resume.certificate), ...readNamed(resume.externalCertificates)]
  const salary = salaryOf(resume.salary)
  const area = Array.isArray(resume.area) ? objectOf(resume.area[0]) : objectOf(resume.area)
  const role = Array.isArray(resume.professionalRole)
    ? objectOf(resume.professionalRole[0])
    : objectOf(resume.professionalRole)

  return {
    externalId: id,
    hash,
    title,
    text: renderText({ title, about, experience, education, certificates }),
    about,
    skills: collectSkills(resume),
    experience,
    education,
    workFormats: readStrings(resume.workFormats).map((item) => item.toUpperCase()),
    salaryAmount:
      salary === null ? null : readNumber(salary.amount) ?? readNumber(salary.salary) ?? readNumber(salary.string),
    salaryCurrency: salary === null ? null : (((c) => (c === "RUR" ? "RUB" : c))(readString(salary.currency) ?? readString(salary.currencyCode))),
    status: readString(attributes.status),
    areaName: readString(area?.name),
    relocation: readStrings(resume.relocation)[0] ?? null,
    businessTripReadiness: readStrings(resume.businessTripReadiness)[0] ?? null,
    travelTime: readStrings(resume.travelTime)[0] ?? null,
    englishLevel: readEnglishLevel(resume.language),
    professionalRole: readString(role?.text) ?? readString(role?.string),
    updatedAt: toIso(attributes.updated)
  }
}

/** A stable key for an experience entry, shared by the operator's enrichment. */
export const resumeExperienceKey = (
  item: Pick<ResumeExperienceItem, "companyName" | "position" | "startDate">
): string =>
  [item.companyName, item.position, item.startDate]
    .map((value) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .join("|")
