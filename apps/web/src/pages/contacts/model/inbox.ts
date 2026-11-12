import type { ConversationChannel, ConversationMessageRecord, ConversationSummary } from "@otbor/contract"

/* -------------------------------------------------------------------------- */
/*  Адрес ↔ состояние ящика                                                    */
/* -------------------------------------------------------------------------- */

export type InboxFilter = "all" | "unread"
export type InboxChannel = ConversationChannel | "all"

export interface InboxState {
  /** Открытый диалог (`?c=`); `null` - не выбран. */
  readonly conversation: string | null
  /** `?filter=unread`; без параметра - все диалоги. */
  readonly filter: InboxFilter
  /** `?channel=mail|telegram|hh_chat`; без параметра - все каналы. */
  readonly channel: InboxChannel
}

export const DEFAULT_INBOX_STATE: InboxState = { conversation: null, filter: "all", channel: "all" }

const CHANNELS: ReadonlyArray<ConversationChannel> = ["mail", "telegram", "hh_chat"]

/** Читает состояние из строки запроса; неизвестные значения тихо игнорируются. */
export const parseInboxState = (search: string): InboxState => {
  const params = new URLSearchParams(search)
  const conversation = params.get("c")
  const channel = params.get("channel")
  return {
    conversation: conversation === null || conversation === "" ? null : conversation,
    filter: params.get("filter") === "unread" ? "unread" : "all",
    channel: CHANNELS.find((item) => item === channel) ?? "all"
  }
}

/** Строка запроса без `?`; значения по умолчанию в адрес не попадают. */
export const inboxSearch = (state: InboxState): string => {
  const params = new URLSearchParams()
  if (state.conversation !== null) params.set("c", state.conversation)
  if (state.filter === "unread") params.set("filter", "unread")
  if (state.channel !== "all") params.set("channel", state.channel)
  return params.toString()
}

export const inboxHref = (state: InboxState): string => {
  const search = inboxSearch(state)
  return search === "" ? "/contacts" : `/contacts?${search}`
}

/** Раздел «Переписки»: `?view=contacts` открывает таблицу контактов. */
export type ContactsView = "inbox" | "contacts"

export const parseContactsView = (search: string): ContactsView =>
  new URLSearchParams(search).get("view") === "contacts" ? "contacts" : "inbox"

/* -------------------------------------------------------------------------- */
/*  Список диалогов                                                            */
/* -------------------------------------------------------------------------- */

const time = (value: string | null): number => {
  if (value === null) return Number.NEGATIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/** Сначала непрочитанные, внутри групп - по времени последнего сообщения (свежие выше). */
export const sortConversations = (
  items: ReadonlyArray<ConversationSummary>
): ReadonlyArray<ConversationSummary> =>
  [...items].sort((left, right) => {
    const unread = Number(right.unreadCount > 0) - Number(left.unreadCount > 0)
    if (unread !== 0) return unread
    const byTime = time(right.lastMessageAt) - time(left.lastMessageAt)
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

export interface InboxQuery {
  readonly filter: InboxFilter
  readonly channel: InboxChannel
  readonly text: string
}

export const filterConversations = (
  items: ReadonlyArray<ConversationSummary>,
  query: InboxQuery
): ReadonlyArray<ConversationSummary> => {
  const needle = query.text.trim().toLowerCase()
  return items.filter((item) => {
    if (item.archived) return false
    if (query.filter === "unread" && item.unreadCount === 0) return false
    if (query.channel !== "all" && item.channel !== query.channel) return false
    if (needle === "") return true
    const haystack = [
      item.title,
      item.personName,
      item.personRole,
      item.lastMessage
    ]
      .filter((part): part is string => typeof part === "string")
      .join("\n")
      .toLowerCase()
    return haystack.includes(needle)
  })
}

export const countUnread = (items: ReadonlyArray<ConversationSummary>): number =>
  items.reduce((sum, item) => (item.archived || item.unreadCount === 0 ? sum : sum + 1), 0)

/** Отправитель-рассылка: имя сервиса, а не человека или компании. */
const isServiceSender = (name: string): boolean => /^(hh(\.ru)?|headhunter|no-?reply)$/i.test(name.trim())

export interface ConversationLinesInput {
  readonly personName: string | null
  readonly personRole: string | null
  readonly title: string | null
  readonly vacancyTitle: string | null
  readonly employerName: string | null
}

/**
 * Две верхние строки диалога в списке. Заголовок отвечает на вопрос «кто пишет»:
 * человек, а если письмо пришло от сервиса (все уведомления hh подписаны «hh.ru») -
 * работодатель, вакансия или тема. Вторая строка - о чём: вакансия и то, что не
 * попало в заголовок. `null` во второй строке - показать название канала.
 */
export const conversationLines = (
  input: ConversationLinesInput
): { readonly headline: string, readonly context: string | null } => {
  const clean = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value.trim())
  const sender = clean(input.personName)
  const person = sender !== null && !isServiceSender(sender) ? sender : null
  const service = sender !== null && person === null ? sender : null
  const title = clean(input.title)
  const topic = title !== null && !isServiceSender(title) ? title : null
  const vacancy = clean(input.vacancyTitle)
  const employer = clean(input.employerName)

  const headline = person ?? employer ?? vacancy ?? topic ?? service ?? title ?? "Без названия"
  const parts = (vacancy !== null ? [vacancy, employer] : [topic, clean(input.personRole)])
    .filter((part): part is string => part !== null && part !== headline)
  if (service !== null && service !== headline) parts.push(`через ${service}`)
  return { headline, context: parts.length === 0 ? null : parts.join(" · ") }
}

/** Сосед выбранного диалога в списке; без выбора первая стрелка берёт край списка. */
export const neighbourId = (
  items: ReadonlyArray<{ readonly id: string }>,
  currentId: string | null,
  delta: 1 | -1
): string | null => {
  if (items.length === 0) return null
  const index = currentId === null ? -1 : items.findIndex((item) => item.id === currentId)
  if (index === -1) return (delta === 1 ? items[0] : items[items.length - 1])?.id ?? null
  const next = Math.min(items.length - 1, Math.max(0, index + delta))
  return items[next]?.id ?? null
}

/* -------------------------------------------------------------------------- */
/*  Время                                                                      */
/* -------------------------------------------------------------------------- */

const pad = (value: number): string => String(value).padStart(2, "0")

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const DAY_MS = 86_400_000
const SHORT_MONTHS = ["янв.", "фев.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сен.", "окт.", "ноя.", "дек."]
const LONG_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря"
]

export const formatClock = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Короткое время для списка: «сейчас», «5 мин», «14:33» (сегодня), «вчера»,
 * «5 окт.», а за другой год «05.10.2024».
 */
export const relativeTime = (value: string | null, now: Date = new Date()): string => {
  if (value === null) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const diff = now.getTime() - date.getTime()
  if (diff >= 0 && diff < 60_000) return "сейчас"
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days === 0) return formatClock(value)
  if (days === 1) return "вчера"
  if (date.getFullYear() !== now.getFullYear()) {
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
  }
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`
}

/** Заголовок дня в переписке: «Сегодня», «Вчера», «5 октября» (с годом, если он не текущий). */
export const dayLabel = (date: Date, now: Date = new Date()): string => {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days === 0) return "Сегодня"
  if (days === 1) return "Вчера"
  const base = `${date.getDate()} ${LONG_MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`
}

export interface MessageDay {
  readonly key: string
  readonly label: string
  readonly messages: ReadonlyArray<ConversationMessageRecord>
}

/** Сообщения по возрастанию времени, сгруппированные по календарным дням (локальное время). */
export const groupMessagesByDay = (
  messages: ReadonlyArray<ConversationMessageRecord>,
  now: Date = new Date()
): ReadonlyArray<MessageDay> => {
  const sorted = [...messages].sort((left, right) => time(left.sentAt) - time(right.sentAt))
  const days: Array<{ key: string; label: string; messages: ConversationMessageRecord[] }> = []
  for (const message of sorted) {
    const date = new Date(message.sentAt)
    const key = Number.isNaN(date.getTime()) ? "unknown" : dayKey(date)
    const last = days[days.length - 1]
    if (last !== undefined && last.key === key) {
      last.messages.push(message)
      continue
    }
    days.push({
      key,
      label: Number.isNaN(date.getTime()) ? "Дата неизвестна" : dayLabel(date, now),
      messages: [message]
    })
  }
  return days
}

/* -------------------------------------------------------------------------- */
/*  Текст сообщения                                                            */
/* -------------------------------------------------------------------------- */

export type TextSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "link"; readonly value: string; readonly href: string }

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
/** Знаки в конце ссылки, которые относятся к предложению, а не к адресу. */
const TRAILING = /[.,;:!?)\]}»]+$/

/** Режет текст на куски и находит в нём http(s)-ссылки; других схем не создаёт. */
export const linkify = (text: string): ReadonlyArray<TextSegment> => {
  const segments: TextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0]
    const trimmed = raw.replace(TRAILING, "")
    if (start > cursor) segments.push({ kind: "text", value: text.slice(cursor, start) })
    segments.push({ kind: "link", value: trimmed, href: trimmed })
    cursor = start + trimmed.length
  }
  if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) })
  return segments
}
