import type { ConversationSummary } from "@otbor/contract"

export const conversationKeys = {
  all: ["conversations"] as const,
  list: (channel: string, query: string) =>
    ["conversations", "list", channel, query] as const,
  vacancyChat: (vacancyId: string, accountId: string, resumeId: string) =>
    ["conversations", "vacancy-chat", vacancyId, accountId, resumeId] as const,
  detail: (id: string) => ["conversations", "detail", id] as const
}

/** Сколько непрочитанных сообщений у каждого человека. */
export const unreadByPerson = (items: ReadonlyArray<ConversationSummary>): ReadonlyMap<string, number> => {
  const result = new Map<string, number>()
  for (const item of items) {
    if (item.personId === null || item.archived || item.unreadCount === 0) continue
    result.set(item.personId, (result.get(item.personId) ?? 0) + item.unreadCount)
  }
  return result
}
