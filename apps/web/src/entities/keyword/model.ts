export const keywordKeys = {
  all: ["keywords"] as const,
  list: (query: string) => ["keywords", "list", query] as const
}
