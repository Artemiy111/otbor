export interface QueueJobListKey {
  readonly kind: string
  readonly status: string
  readonly stage: string
  readonly query: string
  readonly offset: number
  readonly limit: number
}

export const queueJobKeys = {
  all: ["queue"] as const,
  stats: (kind?: string) => ["queue", "stats", kind ?? "all"] as const,
  concurrency: () => ["queue", "concurrency"] as const,
  search: (params: QueueJobListKey) => ["queue", "jobs", params] as const
}
