import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HhAccountId } from "../ids.ts"
import { HhAccountRecord, HhSessionState } from "../models/index.ts"

export const HhAccountsList = Rpc.make("HhAccountsList", {
  success: Schema.Array(HhAccountRecord),
  error: ApiError
})

export const HhAccountUpsert = Rpc.make("HhAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(HhAccountId),
    label: Schema.String,
    isDefault: Schema.optional(Schema.Boolean),
    sessionProfile: Schema.optional(Schema.NullOr(Schema.String)),
    firstName: Schema.optional(Schema.NullOr(Schema.String)),
    lastName: Schema.optional(Schema.NullOr(Schema.String)),
    areaName: Schema.optional(Schema.NullOr(Schema.String)),
    /** `#rrggbb`, or null to go back to the automatic colour. */
    color: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountSessionSet = Rpc.make("HhAccountSessionSet", {
  payload: Schema.Struct({
    id: HhAccountId,
    state: HhSessionState,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountRemove = Rpc.make("HhAccountRemove", {
  payload: Schema.Struct({ id: HhAccountId }),
  success: Schema.Struct({ id: HhAccountId, deleted: Schema.Boolean }),
  error: ApiError
})
