export const keywordKeys = {
  all: ["keywords"] as const,
  /** `presetId` is "all" when the list is not narrowed by a preset. */
  list: (query: string, presetId = "all") => ["keywords", "list", presetId, query] as const
}
