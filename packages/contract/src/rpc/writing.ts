import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { WritingLanguage } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { HarnessJob } from "../models/index.ts"

/**
 * A resume rewrite is inference with context: the cloud enqueues one prompt and
 * never calls a model. Cover letters and form answers are `DraftGenerate`.
 */
export const WritingResume = Rpc.make("WritingResume", {
  payload: Schema.Struct({
    text: Schema.String,
    targetRole: Schema.optional(Schema.String),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})
