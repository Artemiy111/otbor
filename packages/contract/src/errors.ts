import { Schema } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  entity: Schema.String,
  message: Schema.String
}) {}

export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", {
  message: Schema.String
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String
}) {}

export class HarnessRejected extends Schema.TaggedError<HarnessRejected>()("HarnessRejected", {
  message: Schema.String
}) {}

/**
 * An application kit that must not be approved: the answers disagree with the
 * stored form or its hard hints, or a human is still required.
 */
export class AnswersInvalid extends Schema.TaggedError<AnswersInvalid>()("AnswersInvalid", {
  applicationId: Schema.String,
  message: Schema.String,
  problems: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      questionId: Schema.String,
      message: Schema.String
    })
  )
}) {}

export const ApiError = Schema.Union([
  NotFound,
  Conflict,
  InvalidInput,
  StorageError,
  Unauthorized,
  HarnessRejected,
  AnswersInvalid
])

export type ApiError = typeof ApiError.Type
