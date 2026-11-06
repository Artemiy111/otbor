import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { TelegramAccountId } from "../ids.ts"
import { SyncResult, TelegramAccountRecord, TelegramLoginStatusValue } from "../models/index.ts"

export const TelegramAccountsList = Rpc.make("TelegramAccountsList", {
  success: Schema.Array(TelegramAccountRecord),
  error: ApiError
})

export const TelegramAccountUpsert = Rpc.make("TelegramAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(TelegramAccountId),
    label: Schema.String,
    apiId: Schema.Int,
    apiHash: Schema.String,
    phone: Schema.optional(Schema.String)
  }),
  success: TelegramAccountRecord,
  error: ApiError
})

export const TelegramAccountRemove = Rpc.make("TelegramAccountRemove", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({ id: TelegramAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

export const TelegramSyncNow = Rpc.make("TelegramSyncNow", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: SyncResult,
  error: ApiError
})

/** Starts a QR login in a detached fiber and returns the first QR payload. */
export const TelegramLoginQr = Rpc.make("TelegramLoginQr", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({
    qrUrl: Schema.String,
    expiresAt: Schema.String
  }),
  error: ApiError
})

export const TelegramLoginStatus = Rpc.make("TelegramLoginStatus", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({
    status: TelegramLoginStatusValue,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  error: ApiError
})
