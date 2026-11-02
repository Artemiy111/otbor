export const conversationKeys = {
  all: ["conversations"] as const,
  list: (channel: string, query: string) =>
    ["conversations", "list", channel, query] as const,
  detail: (id: string) => ["conversations", "detail", id] as const
}
