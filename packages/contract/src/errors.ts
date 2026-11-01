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

export const ApiError = Schema.Union([
  NotFound,
  Conflict,
  InvalidInput,
  StorageError,
  Unauthorized,
  HarnessRejected
])

export type ApiError = typeof ApiError.Type
