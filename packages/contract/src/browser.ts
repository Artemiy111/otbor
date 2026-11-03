import { Schema } from "effect"
import { FormAnswer } from "./form.ts"

/**
 * Browser job payloads and artifacts: the typed envelope between the cloud
 * and a browser harness. The harness is untrusted; everything it returns is
 * evidence the cloud re-checks, never a verdict.
 */

/** Where the harness finds the account's browser profile. */
const Target = {
  applicationId: Schema.String,
  vacancyId: Schema.String,
  /** hh external vacancy id: the `vacancyId` query parameter. */
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  /** Local profile name of the account's hh session. */
  sessionProfile: Schema.optional(Schema.NullOr(Schema.String))
}

export const PrepareJobPayload = Schema.Struct(Target)

export type PrepareJobPayload = typeof PrepareJobPayload.Type

export const SubmitKit = Schema.Struct({
  formHash: Schema.String,
  letter: Schema.NullOr(Schema.String),
  answers: Schema.Array(FormAnswer)
})

export type SubmitKit = typeof SubmitKit.Type

export const SubmitJobPayload = Schema.Struct({
  ...Target,
  kitId: Schema.String,
  /** The form hash the kit was written for. A live form that differs aborts. */
  expectedFormHash: Schema.String,
  kit: SubmitKit
})

export type SubmitJobPayload = typeof SubmitJobPayload.Type

/** `prepare` artifacts: the live response form as the harness saw it. */
export const PrepareArtifacts = Schema.Struct({
  url: Schema.String,
  /** Form fragment, or the page if no form was found. Size-capped. */
  html: Schema.String
})

export type PrepareArtifacts = typeof PrepareArtifacts.Type

export const SubmitMarker = Schema.Literals(["success", "error", "captcha", "none"])

export type SubmitMarker = typeof SubmitMarker.Type

/**
 * `submit` artifacts. `clicked` is the harness's own claim about whether the
 * submit button was pressed: `false` is only believed together with a
 * pre-click exit tag, `true` or a missing field always means the click may have
 * reached hh. `html` is what the cloud re-checks for the success marker.
 */
export const SubmitEvidence = Schema.Struct({
  clicked: Schema.Boolean,
  url: Schema.String,
  marker: SubmitMarker,
  html: Schema.optional(Schema.String),
  letterAttached: Schema.optional(Schema.Boolean)
})

export type SubmitEvidence = typeof SubmitEvidence.Type
