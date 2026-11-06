import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ContactKind, ContactSource, ConversationChannel } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { ContactId, ConversationId, VacancyId } from "../ids.ts"
import { ContactRecord, ConversationDetail, ConversationSummary } from "../models/index.ts"

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

export const ConversationGet = Rpc.make("ConversationGet", {
  payload: Schema.Struct({ id: ConversationId }),
  success: ConversationDetail,
  error: ApiError
})
