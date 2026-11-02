export interface BlacklistListKey {
  readonly scope: string
  readonly hhAccountId: string
  readonly targetType: string
  readonly query: string
  readonly offset: number
}

export const blacklistKeys = {
  all: ["blacklist"] as const,
  list: (params: BlacklistListKey) => ["blacklist", "list", params] as const
}
