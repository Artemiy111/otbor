export interface CompanyListKey {
  readonly query: string
  readonly offset: number
  readonly includeBlacklisted: boolean
  readonly hhAccountId: string
}

export const companyKeys = {
  all: ["companies"] as const,
  list: (params: CompanyListKey) => ["companies", "list", params] as const,
  detail: (id: string) => ["companies", "detail", id] as const
}
