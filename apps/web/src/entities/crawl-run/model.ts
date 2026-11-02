export const crawlRunKeys = {
  all: ["crawl-runs"] as const,
  list: (url?: string) => ["crawl-runs", "list", url ?? "all"] as const
}
