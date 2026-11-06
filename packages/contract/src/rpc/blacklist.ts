import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { BlacklistScope, BlacklistTarget } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { BlacklistId, HhAccountId } from "../ids.ts"
import { BlacklistRecord } from "../models/index.ts"

/**
 * The blacklist is a soft filter: listing with `includeBlacklisted` shows the
 * same corpus rows, marked instead of removed. `scope` is optional so the UI
 * can present app, account and native tabs over one call.
 */
export const BlacklistList = Rpc.make("BlacklistList", {
  payload: Schema.Struct({
    scope: Schema.optional(BlacklistScope),
    hhAccountId: Schema.optional(HhAccountId),
    targetType: Schema.optional(BlacklistTarget),
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(BlacklistRecord),
    total: Schema.Int
  }),
  error: ApiError
})

export const BlacklistUpsert = Rpc.make("BlacklistUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(BlacklistId),
    scope: BlacklistScope,
    hhAccountId: Schema.optional(HhAccountId),
    targetType: BlacklistTarget,
    externalId: Schema.String,
    name: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String)
  }),
  success: BlacklistRecord,
  error: ApiError
})

export const BlacklistRemove = Rpc.make("BlacklistRemove", {
  payload: Schema.Struct({ id: BlacklistId }),
  success: Schema.Struct({ id: BlacklistId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Import hh's own hidden list; absent entries are never deleted. */
export const BlacklistImportHh = Rpc.make("BlacklistImportHh", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    entries: Schema.Array(
      Schema.Struct({
        targetType: BlacklistTarget,
        externalId: Schema.String,
        name: Schema.optional(Schema.String)
      })
    )
  }),
  success: Schema.Struct({
    imported: Schema.Int,
    updated: Schema.Int,
    skipped: Schema.Int
  }),
  error: ApiError
})
