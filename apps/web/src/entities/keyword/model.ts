export const keywordKeys = {
  all: ["keywords"] as const,
  /** `presetId` is "all" when the list is not narrowed by a preset. */
  list: (query: string, presetId = "all", location = "any") =>
    ["keywords", "list", presetId, location, query] as const
}
