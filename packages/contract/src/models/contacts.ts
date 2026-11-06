import { Schema } from "effect"
import {
  ContactKind,
  ContactSource,
  ConversationChannel,
  MessageDirection,
  MessageKind
} from "../enums.ts"
import { ContactId, ConversationId, EmployerId, VacancyId } from "../ids.ts"

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
  lastSeenAt: Schema.String
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
  vacancyId: Schema.NullOr(VacancyId)
})

export type ConversationSummary = typeof ConversationSummary.Type

export const ConversationMessageRecord = Schema.Struct({
  id: Schema.String,
  externalId: Schema.String,
  direction: MessageDirection,
  sentAt: Schema.String,
  kind: MessageKind,
  text: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.String)
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
