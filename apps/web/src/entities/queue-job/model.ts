export const queueJobKeys = {
  all: ["queue"] as const,
  stats: (kind?: string) => ["queue", "stats", kind ?? "all"] as const,
  list: (status: string, kind?: string) => ["queue", "jobs", kind ?? "all", status] as const
}
