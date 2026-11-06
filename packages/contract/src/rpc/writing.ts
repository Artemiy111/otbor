import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { WritingLanguage } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { ApplicationId } from "../ids.ts"
import { HarnessJob } from "../models/index.ts"

/**
 * Writing is inference with context: the cloud loads the application, the
 * vacancy and the resume, then enqueues one prompt. It never calls a model and
 * never fills a form; the answer is text a human or the harness can use.
 */
export const WritingCoverLetter = Rpc.make("WritingCoverLetter", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    tone: Schema.optional(Schema.String),
    length: Schema.optional(Schema.Literals(["short", "medium", "long"])),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

export const WritingAnswers = Rpc.make("WritingAnswers", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    questions: Schema.Array(Schema.String),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

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
