export const queueJobKeys = {
  all: ["queue"] as const,
  stats: () => ["queue", "stats"] as const,
  list: (status: string) => ["queue", "jobs", status] as const
}
