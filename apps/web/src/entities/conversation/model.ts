import type { ConversationChannel, ConversationListItem, ConversationSummary } from "@otbor/contract"

export const conversationKeys = {
  all: ["conversations"] as const,
  list: (channel: string, query: string) =>
    ["conversations", "list", channel, query] as const,
  vacancyChat: (vacancyId: string, accountId: string, resumeId: string) =>
    ["conversations", "vacancy-chat", vacancyId, accountId, resumeId] as const,
  detail: (id: string) => ["conversations", "detail", id] as const,
  /** Все страницы ящика под одним префиксом: оптимистичные правки идут по нему. */
  inboxAll: ["conversations", "inbox"] as const,
  inbox: (filter: InboxFilterKey) =>
    ["conversations", "inbox", filter.channel, filter.unread ? "unread" : "all", filter.search] as const,
  /** Счётчик непрочитанных для вкладки «Диалоги». */
  unreadTotal: () => ["conversations", "unread-total"] as const
}

/** Строка ящика. Поля контекста есть только у нового сервера; у старого их нет вовсе. */
export type InboxConversation = ConversationSummary &
  Partial<Pick<ConversationListItem, "vacancyTitle" | "employerName" | "hhAccountId" | "readAt">>

export interface InboxPage {
  readonly items: ReadonlyArray<InboxConversation>
  readonly total: number
  readonly unreadTotal: number
}

export interface ConversationSearchInput {
  readonly search?: string
  readonly channel?: ConversationChannel
  readonly unread?: boolean
  readonly archived?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface InboxFilterKey {
  readonly channel: ConversationChannel | "all"
  readonly unread: boolean
  readonly search: string
}

/** Сколько диалогов ящик подгружает за раз. */
export const INBOX_PAGE_SIZE = 50

const textOf = (item: ConversationSummary): string =>
  [item.title, item.personName, item.personRole, item.lastMessage]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase()

/**
 * То же, что делает `ConversationsSearch`, но над списком, который отдал старый
 * сервер (до 200 диалогов): фильтры, поиск по видимому тексту и страница.
 * Порядок сервера (свежие сверху) сохраняется.
 */
export const legacySearch = (
  list: ReadonlyArray<ConversationSummary>,
  input: ConversationSearchInput
): InboxPage => {
  const needle = (input.search ?? "").trim().toLowerCase()
  const base = list.filter((item) => {
    if (input.archived === false && item.archived) return false
    if (input.channel !== undefined && item.channel !== input.channel) return false
    return needle === "" || textOf(item).includes(needle)
  })
  const matched = input.unread === true ? base.filter((item) => item.unreadCount > 0) : base
  const offset = Math.max(input.offset ?? 0, 0)
  const limit = input.limit ?? 50
  return {
    items: matched.slice(offset, offset + limit),
    total: matched.length,
    unreadTotal: base.filter((item) => !item.archived && item.unreadCount > 0).length
  }
}

/**
 * Оптимистичная правка загруженных страниц: у диалога `id` счётчик становится
 * `unread`, а `unreadTotal` на каждой странице сдвигается на одно и то же число.
 * `total` не трогается: строка остаётся в списке (в режиме «непрочитанные» она
 * не прыгает из-под курсора), пока сервер не подтвердит и список не обновится.
 */
export const patchInboxPages = <T extends { readonly pages: ReadonlyArray<InboxPage> }>(
  data: T,
  id: string,
  unread: number
): T => {
  const current = data.pages.flatMap((page) => page.items).find((item) => item.id === id)
  if (current === undefined || current.unreadCount === unread) return data
  const delta = unreadDelta(current.unreadCount, unread, current.archived)
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? { ...item, unreadCount: unread } : item)),
      unreadTotal: Math.max(0, page.unreadTotal + delta)
    }))
  }
}

/** На сколько меняется число непрочитанных диалогов, когда счётчик диалога идёт `from` -> `to`. */
export const unreadDelta = (from: number, to: number, archived: boolean): -1 | 0 | 1 =>
  archived || from > 0 === to > 0 ? 0 : to > 0 ? 1 : -1

/** Сколько непрочитанных сообщений у каждого человека. */
export const unreadByPerson = (items: ReadonlyArray<ConversationSummary>): ReadonlyMap<string, number> => {
  const result = new Map<string, number>()
  for (const item of items) {
    if (item.personId === null || item.archived || item.unreadCount === 0) continue
    result.set(item.personId, (result.get(item.personId) ?? 0) + item.unreadCount)
  }
  return result
}
