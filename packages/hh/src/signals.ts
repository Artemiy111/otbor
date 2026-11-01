import type { WorkFormat } from "@otbor/contract"
import { detectSeniority } from "@otbor/domain"

/** hh stores salary currency either as `RUB` or in `currencyCode`. */
export const mapWorkFormat = (value: string): WorkFormat => {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes("remote") || normalized.includes("удал")) return "remote"
  if (normalized.includes("hybrid") || normalized.includes("гибрид")) return "hybrid"
  if (
    normalized.includes("onsite") ||
    normalized.includes("office") ||
    normalized.includes("офис")
  ) {
    return "office"
  }
  return "unknown"
}

const NEGATIVE_REMOTE = /(?:удаленк\p{L}*|удалёнк\p{L}*|remote)\s*(?:нет|не\s+предусмотрен|отсутств)/iu
const NEGATIVE_OFFICE = /(?:офис\p{L}*|office)\s*(?:нет|не\s+предусмотрен|отсутств)/iu

/**
 * Work format from the body is a fallback for vacancies where hh did not fill
 * the structured field. Explicit negations win: "удалёнки нет" must not be
 * read as remote just because the word is present.
 */
export const detectWorkFormats = (text: string): ReadonlyArray<WorkFormat> => {
  const found = new Set<WorkFormat>()

  if (/(?:^|[^а-яa-z])(?:удаленн|удалённ|remote|из\s+дома|на\s+дому)/iu.test(text)) {
    found.add("remote")
  }
  if (/(?:^|[^а-яa-z])(?:гибрид|hybrid)/iu.test(text)) {
    found.add("hybrid")
  }
  if (/(?:^|[^а-яa-z])(?:офис|office|onsite|в\s+офисе)/iu.test(text)) {
    found.add("office")
  }

  if (NEGATIVE_REMOTE.test(text)) found.delete("remote")
  if (NEGATIVE_OFFICE.test(text)) found.delete("office")

  return [...found]
}

/** Explicit formats from hh win over text inference. */
export const resolveWorkFormats = (
  structured: ReadonlyArray<string>,
  descriptionText: string
): ReadonlyArray<WorkFormat> => {
  const mapped = [...new Set(structured.map(mapWorkFormat))].filter(
    (format): format is Exclude<WorkFormat, "unknown"> => format !== "unknown"
  )
  if (mapped.length > 0) return mapped
  return detectWorkFormats(descriptionText)
}

export const inferSeniority = (title: string, descriptionText: string) =>
  detectSeniority(title, descriptionText)
