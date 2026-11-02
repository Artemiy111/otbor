import { Schema } from "effect"

export class HhParseError extends Schema.TaggedError<HhParseError>()("HhParseError", {
  code: Schema.Literals([
    "page_kind_unknown",
    "initial_state_missing",
    "initial_state_invalid",
    "vacancy_missing",
    "employer_missing"
  ]),
  message: Schema.String
}) {}
