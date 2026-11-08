export const queueJobKeys = {
  all: ["queue"] as const,
  stats: (kind?: string) => ["queue", "stats", kind ?? "all"] as const,
  concurrency: () => ["queue", "concurrency"] as const,
  list: (status: string, kind?: string) => ["queue", "jobs", kind ?? "all", status] as const
}
