import {
  countMatches,
  findTypos,
  normalizeTerm,
  normalizeText,
  termPattern
} from "./text.ts"

export interface LexiconAliasInput {
  readonly id?: string | null
  readonly alias: string
  /** Precomputed by the seed; derived when omitted. */
  readonly normalizedAlias?: string
  readonly typo?: boolean
}

export interface LexiconEntryInput {
  readonly id: string
  readonly term: string
  readonly normalizedTerm?: string
  readonly aliases: ReadonlyArray<LexiconAliasInput>
  readonly enabled?: boolean
}

export interface LexiconMatch {
  readonly keywordId: string
  readonly term: string
  readonly aliasId: string | null
  /** The exact normalized form that was found, never a snippet. */
  readonly matchedForm: string
  readonly typo: boolean
  readonly inTitle: boolean
  readonly titleCount: number
  readonly inBody: boolean
  readonly bodyCount: number
  readonly inSkills: boolean
}

export interface MatchInput {
  readonly title: string
  readonly body: string
  readonly skills: ReadonlyArray<string>
}

interface Candidate {
  readonly aliasId: string | null
  readonly form: string
  readonly typo: boolean
}

/**
 * One row per *form*, not one row per term.
 *
 * If an employer writes `Kubernetes` in the title and `k8s` in the body, both
 * rows survive. Collapsing them to one would lose the form distribution that
 * the lexicon view needs, and it cannot be reconstructed later.
 */
export const matchLexicon = (
  entries: ReadonlyArray<LexiconEntryInput>,
  input: MatchInput
): ReadonlyArray<LexiconMatch> => {
  const title = normalizeText(input.title)
  const body = normalizeText(input.body)
  const skills = input.skills.map(normalizeText).filter((skill) => skill.length > 0)

  const rows = new Map<string, LexiconMatch>()

  const add = (keywordId: string, term: string, candidate: Candidate, counts: {
    titleCount: number
    bodyCount: number
    inSkills: boolean
  }) => {
    if (counts.titleCount === 0 && counts.bodyCount === 0 && !counts.inSkills) return

    const key = `${keywordId}\u0000${candidate.form}`
    const existing = rows.get(key)
    if (existing !== undefined) {
      if (candidate.aliasId !== null && existing.aliasId === null) {
        rows.set(key, { ...existing, aliasId: candidate.aliasId })
      }
      return
    }

    rows.set(key, {
      keywordId,
      term,
      aliasId: candidate.aliasId,
      matchedForm: candidate.form,
      typo: candidate.typo,
      inTitle: counts.titleCount > 0,
      titleCount: counts.titleCount,
      inBody: counts.bodyCount > 0,
      bodyCount: counts.bodyCount,
      inSkills: counts.inSkills
    })
  }

  for (const entry of entries) {
    if (entry.enabled === false) continue

    const forms: Candidate[] = [
      {
        aliasId: null,
        form: normalizeTerm(entry.term),
        typo: false
      },
      ...entry.aliases.map((alias) => ({
        aliasId: alias.id ?? null,
        form: alias.normalizedAlias ?? normalizeTerm(alias.alias),
        typo: alias.typo === true
      }))
    ]

    const known = new Set(forms.map((form) => form.form))

    for (const candidate of forms) {
      const pattern = termPattern(candidate.form)
      const titleCount = countMatches(title, pattern)
      const bodyCount = countMatches(body, pattern)
      const skillPattern = termPattern(candidate.form)
      const inSkills = skills.some((skill) => {
        skillPattern.lastIndex = 0
        return skillPattern.test(skill)
      })

      add(entry.id, entry.term, candidate, { titleCount, bodyCount, inSkills })
    }

    // Typos are attributed to the canonical term and stored as a separate
    // form. They never become a recommendation for the resume.
    const typoText = `${title}\n${body}`
    for (const typo of findTypos(typoText, entry.term)) {
      if (known.has(typo)) continue
      const typoPattern = termPattern(typo)
      add(entry.id, entry.term, { aliasId: null, form: typo, typo: true }, {
        titleCount: countMatches(title, typoPattern),
        bodyCount: countMatches(body, typoPattern),
        inSkills: skills.some((skill) => {
          typoPattern.lastIndex = 0
          return typoPattern.test(skill)
        })
      })
    }
  }

  return [...rows.values()].sort(
    (a, b) => a.term.localeCompare(b.term, "ru") || a.matchedForm.localeCompare(b.matchedForm, "ru")
  )
}

/** Canonical terms with a match in the requested location. */
export const matchedTerms = (
  matches: ReadonlyArray<LexiconMatch>,
  location: "title" | "body" | "skills" | "any" = "any"
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  for (const match of matches) {
    if (match.typo) continue
    const hit =
      location === "any"
        ? match.inTitle || match.inBody || match.inSkills
        : location === "title"
          ? match.inTitle
          : location === "body"
            ? match.inBody
            : match.inSkills
    if (hit) seen.add(normalizeTerm(match.term))
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ru"))
}

/** The form an employer writes most often. Useful for resume suggestions. */
export const dominantForm = (matches: ReadonlyArray<LexiconMatch>): string | null => {
  const counts = new Map<string, number>()
  for (const match of matches) {
    const current = counts.get(match.matchedForm) ?? 0
    counts.set(match.matchedForm, current + match.titleCount + match.bodyCount)
  }
  let best: string | null = null
  let bestCount = -1
  for (const [form, count] of counts) {
    if (count > bestCount) {
      best = form
      bestCount = count
    }
  }
  return best
}
