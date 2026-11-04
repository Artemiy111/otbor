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

/** `reconcile` reads the site for an application whose submit is unknown. */
export const ReconcileJobPayload = Schema.Struct(Target)

export type ReconcileJobPayload = typeof ReconcileJobPayload.Type

export const ReconcilePage = Schema.Struct({
  /** Final URL after redirects. */
  url: Schema.String,
  html: Schema.String
})

export type ReconcilePage = typeof ReconcilePage.Type

/**
 * `reconcile` artifacts: the pages the harness read, nothing more. The harness
 * does not say whether a response exists; the cloud parses these pages and
 * decides. A missing part means "not read".
 */
export const ReconcileEvidence = Schema.Struct({
  externalId: Schema.String,
  /** `/vacancy/<id>` as the account sees it. */
  vacancy: Schema.optional(ReconcilePage),
  /** `/applicant/negotiations?page=0..n`, in order, as many as were read. */
  negotiations: Schema.optional(Schema.Array(ReconcilePage))
})

export type ReconcileEvidence = typeof ReconcileEvidence.Type

/**
 * `negotiations_sync` reads the account's whole negotiations list, so that
 * responses made by hand on hh.ru become visible to dedupe. It has no
 * application: the account is the target.
 */
export const NegotiationsSyncJobPayload = Schema.Struct({
  hhAccountId: Schema.String,
  /** Local profile name of the account's hh session. */
  sessionProfile: Schema.optional(Schema.NullOr(Schema.String)),
  /** Pages to read at most; the harness also applies its own cap. */
  maxPages: Schema.optional(Schema.Int)
})

export type NegotiationsSyncJobPayload = typeof NegotiationsSyncJobPayload.Type

/**
 * `negotiations_sync` artifacts: `/applicant/negotiations?page=0..n`, in order,
 * as many as were read. The harness does not parse or judge them.
 */
export const NegotiationsSyncEvidence = Schema.Struct({
  pages: Schema.Array(ReconcilePage)
})

export type NegotiationsSyncEvidence = typeof NegotiationsSyncEvidence.Type

/**
 * `resume_sync` reads the account's own resumes: the profile page lists the
 * cards, then each `/resume/<hash>` is opened. No application: the account is
 * the target. Read-only; nothing on a page is clicked.
 */
export const ResumeSyncJobPayload = Schema.Struct({
  hhAccountId: Schema.String,
  /** Local profile name of the account's hh session. */
  sessionProfile: Schema.optional(Schema.NullOr(Schema.String)),
  /** Resumes to read at most; the harness also applies its own cap. */
  maxResumes: Schema.optional(Schema.Int)
})

export type ResumeSyncJobPayload = typeof ResumeSyncJobPayload.Type

/**
 * `resume_sync` artifacts: the profile page (the resume cards) and the resume
 * pages that were opened. The harness does not parse or judge them.
 */
export const ResumeSyncEvidence = Schema.Struct({
  profile: ReconcilePage,
  resumes: Schema.Array(ReconcilePage)
})

export type ResumeSyncEvidence = typeof ResumeSyncEvidence.Type
