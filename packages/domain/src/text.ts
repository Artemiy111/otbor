/**
 * Text primitives for the gate and the lexicon.
 *
 * Everything here is pure and synchronous: the same functions run in the
 * browser harness and in the cloud, and there is no locale-dependent casing.
 */

const QUOTES = /[«»""''`]/g
const EDGE_PUNCTUATION = /^[\s.,;:!?()[\]{}]+|[\s.,;:!?()[\]{}]+$/g

export const collapseWhitespace = (input: string): string =>
  input.replace(/\s+/g, " ").trim()

/** Normalized form of a dictionary term or a matched form. */
export const normalizeTerm = (input: string): string =>
  collapseWhitespace(
    input
      .normalize("NFKC")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(QUOTES, "")
      .replace(EDGE_PUNCTUATION, "")
  )

/**
 * Text used for matching. Case, ё and non-breaking spaces are normalized, but
 * punctuation is preserved because word boundaries depend on it.
 */
export const normalizeText = (input: string): string =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u00a0\u202f\u2009]/g, " ")

const SENIORITY_TOKENS = new Set([
  "senior",
  "middle",
  "junior",
  "lead",
  "principal",
  "staff",
  "intern",
  "trainee",
  "сеньор",
  "мидл",
  "джун",
  "стажер",
  "стажёр",
  "ведущий",
  "старший",
  "младший"
])

const FORMAT_TOKENS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "office",
  "удаленно",
  "гибрид",
  "офис"
])

/**
 * Stable cache key for `title_verdict`.
 *
 * Grade and work-format words are removed so "Senior DevOps (remote)" and
 * "DevOps engineer" share one role decision. Seniority itself is detected from
 * the original title and stored on the vacancy.
 */
export const titleCacheKey = (input: string): string => {
  const tokens = normalizeText(input)
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^\p{L}\p{N}\s/+#.-]/gu, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 0 && !SENIORITY_TOKENS.has(token) && !FORMAT_TOKENS.has(token))

  return collapseWhitespace(tokens.join(" "))
    .replace(/\s*\/\s*/g, "/")
    .replace(/[.,;:!?]+$/g, "")
}

export const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Regex that matches a normalized term with Unicode word boundaries. */
export const termPattern = (term: string): RegExp => {
  const body = normalizeTerm(term)
    .split(/\s+/)
    .map((part) => escapeRegExp(part).replace(/е/g, "[её]"))
    .join("[\\s\\u00a0]+")

  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu")
}

/** Count word-boundary matches without building a match array. */
export const countMatches = (text: string, pattern: RegExp): number => {
  let count = 0
  for (const _ of text.matchAll(pattern)) count += 1
  return count
}

export const containsMatch = (text: string, pattern: RegExp): boolean => {
  pattern.lastIndex = 0
  const matched = pattern.test(text)
  pattern.lastIndex = 0
  return matched
}

/**
 * Levenshtein distance with an early exit. Typo candidates are at most one
 * edit away, so the full matrix is never needed for long words.
 */
export const isOneEditApart = (a: string, b: string): boolean => {
  if (a === b) return false
  const lengthDelta = Math.abs(a.length - b.length)
  if (lengthDelta > 1) return false

  let i = 0
  let j = 0
  let edits = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }

    edits += 1
    if (edits > 1) return false

    if (a.length > b.length) {
      i += 1
    } else if (a.length < b.length) {
      j += 1
    } else {
      i += 1
      j += 1
    }
  }

  if (i < a.length || j < b.length) edits += 1
  return edits === 1
}

const LATIN_WORD = /^[a-z][a-z0-9+#.-]{2,}$/

/**
 * Finds Latin spellings one edit away from a dictionary term.
 *
 * Only terms of seven or more characters are considered: `Kubernetis` is a
 * useful signal, while a six-letter term would produce false positives from
 * ordinary English words.
 */
export const findTypos = (
  text: string,
  canonicalTerm: string
): ReadonlyArray<string> => {
  const term = normalizeTerm(canonicalTerm)
  if (term.length < 7 || !/^[a-z][a-z0-9+#.-]*$/.test(term)) return []

  const found = new Set<string>()
  for (const raw of normalizeText(text).matchAll(/[\p{L}\p{N}+#.-]+/gu)) {
    const token = raw[0].replace(/^[.-]+|[.-]+$/g, "")
    if (!LATIN_WORD.test(token) || token.length < 7) continue
    if (token[0] !== term[0]) continue
    if (isOneEditApart(token, term)) found.add(token)
  }

  return [...found]
}

/** First few words around a match, useful for CLI explanations. */
export const evidenceAround = (
  text: string,
  pattern: RegExp,
  radius = 60
): string | null => {
  const match = pattern.exec(text)
  if (match === null || match.index === undefined) return null
  const start = Math.max(0, match.index - radius)
  const end = Math.min(text.length, match.index + match[0].length + radius)
  return collapseWhitespace(text.slice(start, end))
}
