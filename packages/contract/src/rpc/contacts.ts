import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ContactKind, ContactSource, ConversationChannel } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { ContactId, ConversationId, HhAccountId, PersonId, ResumeId, VacancyId } from "../ids.ts"
import {
  ContactRecord,
  ConversationDetail,
  ConversationListItem,
  ConversationSearchResult,
  ConversationSummary,
  VacancyChat
} from "../models/index.ts"

export const ContactsList = Rpc.make("ContactsList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    kind: Schema.optional(ContactKind),
    source: Schema.optional(ContactSource),
    vacancyId: Schema.optional(VacancyId),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(ContactRecord),
    total: Schema.Int
  }),
  error: ApiError
})

export const ContactRemove = Rpc.make("ContactRemove", {
  payload: Schema.Struct({ id: ContactId }),
  success: Schema.Struct({ id: ContactId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Re-runs contact extraction over stored vacancies; useful after parser changes. */
export const ContactsExtract = Rpc.make("ContactsExtract", {
  success: Schema.Struct({
    scanned: Schema.Int,
    contacts: Schema.Int
  }),
  error: ApiError
})

export const ConversationsList = Rpc.make("ConversationsList", {
  payload: Schema.Struct({
    channel: Schema.optional(ConversationChannel),
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(ConversationSummary),
  error: ApiError
})

/**
 * Постраничный список диалогов с серверным поиском и фильтрами.
 * `search` ищет по имени собеседника, заголовку и тексту сообщений.
 */
export const ConversationsSearch = Rpc.make("ConversationsSearch", {
  payload: Schema.Struct({
    search: Schema.optional(Schema.String),
    channel: Schema.optional(ConversationChannel),
    /** `true`: только непрочитанные. */
    unread: Schema.optional(Schema.Boolean),
    /** `false`: без архивных диалогов; без поля архивные тоже показываются. */
    archived: Schema.optional(Schema.Boolean),
    accountId: Schema.optional(Schema.String),
    personId: Schema.optional(PersonId),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: ConversationSearchResult,
  error: ApiError
})

/** Отмечает диалог прочитанным только в otbor; почту, Telegram и hh не трогает. */
export const ConversationMarkRead = Rpc.make("ConversationMarkRead", {
  payload: Schema.Struct({ id: ConversationId }),
  success: ConversationListItem,
  error: ApiError
})

/** Возвращает диалог в непрочитанные (только состояние otbor). */
export const ConversationMarkUnread = Rpc.make("ConversationMarkUnread", {
  payload: Schema.Struct({ id: ConversationId }),
  success: ConversationListItem,
  error: ApiError
})

export const ConversationGet = Rpc.make("ConversationGet", {
  payload: Schema.Struct({ id: ConversationId }),
  success: ConversationDetail,
  error: ApiError
})

const VacancyChatKey = Schema.Struct({
  vacancyId: VacancyId,
  hhAccountId: HhAccountId,
  resumeId: Schema.optional(Schema.NullOr(ResumeId))
})

/** The stored hh chat of a vacancy for a resume. Never waits for hh.ru. */
export const VacancyChatGet = Rpc.make("VacancyChatGet", {
  payload: VacancyChatKey,
  success: VacancyChat,
  error: ApiError
})

/** Queues one `chat_read` job (unless one is running) and returns at once. */
export const VacancyChatRefresh = Rpc.make("VacancyChatRefresh", {
  payload: VacancyChatKey,
  success: VacancyChat,
  error: ApiError
})
