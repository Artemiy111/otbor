import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { EmployerBlacklistView } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { EmployerId, HhAccountId } from "../ids.ts"
import { EmployerDetail, EmployerSummary } from "../models/index.ts"

export const EmployersList = Rpc.make("EmployersList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** The companies page toggle: `true` shows blacklisted employers. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Overrides `includeBlacklisted` when set. */
    blacklistView: Schema.optional(EmployerBlacklistView),
    /** With `blacklistView = "account"`: only employers this hh account blocked. */
    blockedByAccountId: Schema.optional(HhAccountId),
    hhAccountId: Schema.optional(HhAccountId),
    /** Only employers this hh account has responded to. */
    respondedAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Struct({
    items: Schema.Array(EmployerSummary),
    total: Schema.Int
  }),
  error: ApiError
})

export const EmployersGet = Rpc.make("EmployersGet", {
  payload: Schema.Struct({ id: EmployerId }),
  success: EmployerDetail,
  error: ApiError
})
