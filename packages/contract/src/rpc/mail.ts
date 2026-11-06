import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { MailAccountId } from "../ids.ts"
import { MailAccountRecord, SyncResult } from "../models/index.ts"

export const MailAccountsList = Rpc.make("MailAccountsList", {
  success: Schema.Array(MailAccountRecord),
  error: ApiError
})

export const MailAccountUpsert = Rpc.make("MailAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(MailAccountId),
    label: Schema.String,
    address: Schema.String,
    host: Schema.String,
    port: Schema.Int,
    secure: Schema.optional(Schema.Boolean),
    username: Schema.String,
    /** App password. Omitted keeps the stored secret; never returned. */
    password: Schema.optional(Schema.String),
    includeSent: Schema.optional(Schema.Boolean),
    backfillDays: Schema.optional(Schema.Int),
    enabled: Schema.optional(Schema.Boolean)
  }),
  success: MailAccountRecord,
  error: ApiError
})

export const MailAccountRemove = Rpc.make("MailAccountRemove", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: Schema.Struct({ id: MailAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

export const MailAccountTest = Rpc.make("MailAccountTest", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: Schema.Struct({
    ok: Schema.Boolean,
    address: Schema.String,
    folders: Schema.Int,
    messages: Schema.NullOr(Schema.Int)
  }),
  error: ApiError
})

/** Synchronous on purpose: a manual sync is short and the operator waits. */
export const MailSyncNow = Rpc.make("MailSyncNow", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: SyncResult,
  error: ApiError
})
