import { Schema } from "effect"
import {
  ContactKind,
  ContactSource,
  ConversationChannel,
  MessageDirection,
  MessageKind,
  PersonLink
} from "../enums.ts"
import { ContactId, ConversationId, EmployerId, PersonId, VacancyId } from "../ids.ts"

/**
 * One way to reach a person. The same `kind`+`value` is unique per user, so a
 * second sighting updates evidence and confidence instead of adding a row.
 */
export const ContactSummary = Schema.Struct({
  id: ContactId,
  personName: Schema.NullOr(Schema.String),
  personRole: Schema.NullOr(Schema.String),
  kind: ContactKind,
  value: Schema.String,
  url: Schema.NullOr(Schema.String),
  source: ContactSource,
  confidence: Schema.NullOr(Schema.Number),
  isBot: Schema.Boolean,
  vacancyId: Schema.NullOr(VacancyId),
  lastSeenAt: Schema.String,
  /** The person this identity belongs to, when linked. */
  personId: Schema.NullOr(PersonId),
  /** How the link was made; `null` when `personId` is `null`. */
  personLink: Schema.NullOr(PersonLink)
})

export type ContactSummary = typeof ContactSummary.Type

export const ContactRecord = Schema.Struct({
  ...ContactSummary.fields,
  evidence: Schema.NullOr(Schema.String),
  employerId: Schema.NullOr(EmployerId),
  firstSeenAt: Schema.String,
  /** hh accounts whose hh chat is about this contact's vacancy. */
  hhAccountIds: Schema.Array(Schema.String)
})

export type ContactRecord = typeof ContactRecord.Type

export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  channel: ConversationChannel,
  /** Mail account / Telegram account id, as text so a channel can be rerouted. */
  accountId: Schema.String,
  externalId: Schema.String,
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  personName: Schema.NullOr(Schema.String),
  personRole: Schema.NullOr(Schema.String),
  lastMessageAt: Schema.NullOr(Schema.String),
  unreadCount: Schema.Int,
  archived: Schema.Boolean,
  /** Text of the newest stored message, for list previews. */
  lastMessage: Schema.NullOr(Schema.String),
  /** The vacancy the thread is about, when one was linked. */
  vacancyId: Schema.NullOr(VacancyId),
  /** The human counterparty of the thread, when resolved. */
  personId: Schema.NullOr(PersonId)
})

export type ConversationSummary = typeof ConversationSummary.Type

/**
 * Строка списка диалогов: сводка плюс контекст вакансии, чтобы список не
 * запрашивал вакансию отдельно для каждой строки. `unreadCount` здесь и в
 * `ConversationSummary` считается по правилу otbor (см. `read_at` у диалога),
 * а не по значению, которое записал синк источника.
 */
export const ConversationListItem = Schema.Struct({
  ...ConversationSummary.fields,
  /** Название вакансии, к которой привязан диалог. */
  vacancyTitle: Schema.NullOr(Schema.String),
  /** Работодатель этой вакансии. */
  employerName: Schema.NullOr(Schema.String),
  /** Аккаунт hh: только у диалогов канала `hh_chat`, иначе `null`. */
  hhAccountId: Schema.NullOr(Schema.String),
  /** Когда оператор последний раз отметил диалог прочитанным в otbor. */
  readAt: Schema.NullOr(Schema.String)
})

export type ConversationListItem = typeof ConversationListItem.Type

/** Страница списка диалогов с итогами по всей выборке, а не по странице. */
export const ConversationSearchResult = Schema.Struct({
  items: Schema.Array(ConversationListItem),
  /** Сколько диалогов подходит под фильтры (включая `unread`). */
  total: Schema.Int,
  /** Сколько непрочитанных (не в архиве) подходит под остальные фильтры, без учёта `unread`. */
  unreadTotal: Schema.Int
})

export type ConversationSearchResult = typeof ConversationSearchResult.Type

export const ConversationMessageRecord = Schema.Struct({
  id: Schema.String,
  externalId: Schema.String,
  direction: MessageDirection,
  sentAt: Schema.String,
  kind: MessageKind,
  text: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.String),
  /**
   * Отправитель письма. Хранится только у почты (`from_json`); у Telegram и
   * чата hh есть лишь `direction`, поэтому там поля отсутствуют или `null`.
   */
  senderName: Schema.optional(Schema.NullOr(Schema.String)),
  senderAddress: Schema.optional(Schema.NullOr(Schema.String))
})

export type ConversationMessageRecord = typeof ConversationMessageRecord.Type

export const ConversationDetail = Schema.Struct({
  conversation: ConversationSummary,
  messages: Schema.Array(ConversationMessageRecord)
})

export type ConversationDetail = typeof ConversationDetail.Type

/* -------------------------------------------------------------------------- */

/**
 * The hh chat of a vacancy for one resume (hh keeps one chat per response).
 * `fetch` is the state of the newest `chat_read` job; `detail` is what is
 * stored, so the page can show the last known messages while a refresh runs.
 */
export const VacancyChat = Schema.Struct({
  /** `null`: there is no response with this resume, or its chat id is unknown. */
  chatId: Schema.NullOr(Schema.String),
  fetch: Schema.Literals(["none", "pending", "running", "done", "failed", "needs_human"]),
  message: Schema.NullOr(Schema.String),
  fetchedAt: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(ConversationDetail)
})

export type VacancyChat = typeof VacancyChat.Type
