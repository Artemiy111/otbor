const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

interface ResumeLike {
  readonly title: string
  readonly text: string
  readonly about: string
  readonly skills: ReadonlyArray<string>
}

/**
 * Does the resume mention any of the given words? Whole-word match, case
 * insensitive, so "CI" does not match "specific".
 */
export const makeResumeMatcher = (resume: ResumeLike | null) => {
  if (resume === null) return null
  const haystack = [resume.title, resume.about, resume.text, ...resume.skills].join("\n")
  return (words: ReadonlyArray<string>): boolean =>
    words.some((word) => {
      const trimmed = word.trim()
      if (trimmed === "") return false
      return new RegExp(`(?<![\\p{L}\\p{N}])${escape(trimmed)}(?![\\p{L}\\p{N}])`, "iu").test(haystack)
    })
}
