export interface VacancyListKey {
  readonly analysed: string
  readonly respondedAccountId: string
  readonly search: string
  readonly sort: string
  readonly page: string
  readonly pageSize: number
  readonly includeArchived: boolean
  readonly includeBlacklisted: boolean
  readonly hhAccountId: string
  /** JSON of the ad-hoc rule filter, empty when none. */
  readonly filter: string
  readonly verdict: string
  readonly applied: string
  readonly seenSince: string
}

export const vacancyKeys = {
  all: ["vacancies"] as const,
  list: (params: VacancyListKey) => ["vacancies", "list", params] as const,
  detail: (id: string) => ["vacancies", "detail", id] as const,
  analysis: (id: string) => ["vacancies", "analysis", id] as const
}
