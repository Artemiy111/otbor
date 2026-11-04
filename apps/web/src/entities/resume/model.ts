export const resumeKeys = {
  all: ["resumes"] as const,
  list: (accountId?: string) => ["resumes", "list", accountId ?? "all"] as const,
  detail: (id: string) => ["resumes", "detail", id] as const,
  enrichment: (id: string) => ["resumes", "enrichment", id] as const
}

const letterOf = (title: string): string => (title.trim()[0] ?? "?").toUpperCase()

/**
 * Short resume code for compact UI: the first letter of the title; when several
 * resumes of the same account start with the same letter, a number is appended
 * in list order (D1, D2).
 */
export const resumeCode = (title: string, accountResumeTitles: ReadonlyArray<string>): string => {
  const letter = letterOf(title)
  const same = accountResumeTitles.filter((candidate) => letterOf(candidate) === letter)
  return same.length > 1 ? `${letter}${same.indexOf(title) + 1}` : letter
}
