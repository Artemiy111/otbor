import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { PresetId } from "../ids.ts"
import { PresetFilter, PresetPreview, PresetRecord } from "../models/index.ts"

export const PresetsList = Rpc.make("PresetsList", {
  payload: Schema.Struct({
    kind: Schema.optional(Schema.String)
  }),
  success: Schema.Array(PresetRecord),
  error: ApiError
})

export const PresetsUpsert = Rpc.make("PresetsUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(Schema.String),
    kind: Schema.Literals(["explore", "apply"]),
    title: Schema.String,
    filter: Schema.optional(PresetFilter),
    system: Schema.optional(Schema.Boolean)
  }),
  success: PresetRecord,
  error: ApiError
})

export const PresetsRemove = Rpc.make("PresetsRemove", {
  payload: Schema.Struct({ id: PresetId }),
  success: Schema.Struct({ id: PresetId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Counts and facets for the unsaved filter currently being edited. */
export const PresetsPreview = Rpc.make("PresetsPreview", {
  payload: Schema.Struct({ filter: PresetFilter }),
  success: PresetPreview,
  error: ApiError
})
