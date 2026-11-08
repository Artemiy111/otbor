import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { ContactId, ConversationId, PersonId } from "../ids.ts"
import {
  ContactRecord,
  PeopleRelinkResult,
  PersonRecord,
  PersonSummary
} from "../models/index.ts"

export const PersonList = Rpc.make("PersonList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(PersonSummary),
    total: Schema.Int
  }),
  error: ApiError
})

export const PersonGet = Rpc.make("PersonGet", {
  payload: Schema.Struct({ id: PersonId }),
  success: PersonRecord,
  error: ApiError
})

/** Edits the fields an operator owns; automation never writes them back. */
export const PersonUpdate = Rpc.make("PersonUpdate", {
  payload: Schema.Struct({
    id: PersonId,
    name: Schema.optional(Schema.NullOr(Schema.String)),
    role: Schema.optional(Schema.NullOr(Schema.String)),
    notes: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: PersonRecord,
  error: ApiError
})

/** Moves contacts and conversations of `from` to `into`; `from` is kept and points at `into`. */
export const PersonMerge = Rpc.make("PersonMerge", {
  payload: Schema.Struct({ into: PersonId, from: PersonId }),
  success: PersonRecord,
  error: ApiError
})

/** Detaches one contact into a new person. */
export const PersonSplit = Rpc.make("PersonSplit", {
  payload: Schema.Struct({ contactId: ContactId }),
  success: PersonRecord,
  error: ApiError
})

/** Turns a `suggested` link into a `manual` one. */
export const ContactConfirm = Rpc.make("ContactConfirm", {
  payload: Schema.Struct({ contactId: ContactId }),
  success: ContactRecord,
  error: ApiError
})

/** Drops a `suggested` link; the contact stays but belongs to nobody. */
export const ContactReject = Rpc.make("ContactReject", {
  payload: Schema.Struct({ contactId: ContactId }),
  success: ContactRecord,
  error: ApiError
})

/** Re-runs linking for one conversation or for all of them. */
export const PeopleRelink = Rpc.make("PeopleRelink", {
  payload: Schema.Struct({ conversationId: Schema.optional(ConversationId) }),
  success: PeopleRelinkResult,
  error: ApiError
})
