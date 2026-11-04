export interface VacancyListKey {
  readonly gate: string
  readonly includeArchived: boolean
  readonly includeBlacklisted: boolean
  readonly hhAccountId: string
}

export const vacancyKeys = {
  all: ["vacancies"] as const,
  list: (params: VacancyListKey) => ["vacancies", "list", params] as const,
  detail: (id: string) => ["vacancies", "detail", id] as const,
  gate: (title: string) => ["vacancies", "gate", title] as const
}
