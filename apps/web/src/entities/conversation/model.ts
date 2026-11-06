export const conversationKeys = {
  all: ["conversations"] as const,
  list: (channel: string, query: string) =>
    ["conversations", "list", channel, query] as const,
  vacancyChat: (vacancyId: string, accountId: string, resumeId: string) =>
    ["conversations", "vacancy-chat", vacancyId, accountId, resumeId] as const,
  detail: (id: string) => ["conversations", "detail", id] as const
}
