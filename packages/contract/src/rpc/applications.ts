import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { ApplicationId, HhAccountId, ResumeId, VacancyId } from "../ids.ts"
import { FormAnswer } from "../form.ts"
import {
  ApplicationDetail,
  ApplicationRecord,
  BrowserDrafts,
  BrowserSubmitResult,
  KitAnswer,
  KitRecord,
  LetterAttachStatus,
  LetterDraft,
  VacancyFormState
} from "../models/index.ts"

export const ApplicationsList = Rpc.make("ApplicationsList", {
  payload: Schema.Struct({
    state: Schema.optional(Schema.String),
    /** Only applications of this hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    /** Only applications to this vacancy (every account and resume). */
    vacancyId: Schema.optional(VacancyId),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(ApplicationRecord),
  error: ApiError
})

export const ApplicationsGet = Rpc.make("ApplicationsGet", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationDetail,
  error: ApiError
})

export const ApplicationsCreateFromDecision = Rpc.make("ApplicationsCreateFromDecision", {
  payload: Schema.Struct({
    decisionId: Schema.String,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String)
  }),
  success: ApplicationRecord,
  error: ApiError
})

/**
 * Manual mode: an application the operator chose, without a decision. Policy
 * (verdict, blacklist, fit) is not consulted; at most one application per
 * (account, vacancy) still holds, so an existing one is returned with
 * `created: false`. Queues the same prepare job as a decision-based draft.
 */
export const ApplicationsCreateManual = Rpc.make("ApplicationsCreateManual", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ application: ApplicationRecord, created: Schema.Boolean }),
  error: ApiError
})

/** The response form of a vacancy as last read. Never opens hh. */
export const VacancyFormGet = Rpc.make("VacancyFormGet", {
  payload: Schema.Struct({ vacancyId: VacancyId }),
  success: VacancyFormState,
  error: ApiError
})

/**
 * Queues a form read when the stored form is older than a day, or always with
 * `force`. Creates no application. Returns the state as it is now.
 */
export const VacancyFormRefresh = Rpc.make("VacancyFormRefresh", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    force: Schema.optional(Schema.Boolean)
  }),
  success: VacancyFormState,
  error: ApiError
})

/**
 * Adds a cover letter to the response hh already holds for the vacancy. Queues
 * one browser job and returns at once. The same letter is never queued twice.
 */
export const VacancyLetterAttach = Rpc.make("VacancyLetterAttach", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    /** Which response (hh keeps one per resume); required when the account has several. */
    resumeId: Schema.optional(Schema.NullOr(ResumeId)),
    letter: Schema.String
  }),
  success: LetterAttachStatus,
  error: ApiError
})

export const VacancyLetterAttachStatusGet = Rpc.make("VacancyLetterAttachStatus", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.NullOr(ResumeId))
  }),
  success: LetterAttachStatus,
  error: ApiError
})

/** The unsent letter for one response; every resume has its own. */
export const VacancyLetterDraftGet = Rpc.make("VacancyLetterDraftGet", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.NullOr(ResumeId)
  }),
  success: LetterDraft,
  error: ApiError
})

/** Saves the letter; blank text deletes the draft. */
export const VacancyLetterDraftSave = Rpc.make("VacancyLetterDraftSave", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.NullOr(ResumeId),
    letter: Schema.String
  }),
  success: LetterDraft,
  error: ApiError
})

export const ApplicationsApprove = Rpc.make("ApplicationsApprove", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationRecord,
  error: ApiError
})

export const ApplicationsSkip = Rpc.make("ApplicationsSkip", {
  payload: Schema.Struct({
    id: ApplicationId,
    reason: Schema.optional(Schema.String)
  }),
  success: ApplicationRecord,
  error: ApiError
})

export const ApplicationsRetry = Rpc.make("ApplicationsRetry", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationRecord,
  error: ApiError
})

/** The only place an application kit crosses the boundary. */
export const ApplicationsSetKit = Rpc.make("ApplicationsSetKit", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    formHash: Schema.String,
    letter: Schema.optional(Schema.NullOr(Schema.String)),
    answers: Schema.optional(Schema.Array(KitAnswer)),
    model: Schema.optional(Schema.NullOr(Schema.String)),
    promptHash: Schema.optional(Schema.NullOr(Schema.String)),
    costUsd: Schema.optional(Schema.NullOr(Schema.Number))
  }),
  success: KitRecord,
  error: ApiError
})

/**
 * The drafts of one hh vacancy (by its hh id), for the extension to paste into
 * the response form the operator opened on hh.ru. Read only.
 */
export const VacancyBrowserDrafts = Rpc.make("VacancyBrowserDrafts", {
  payload: Schema.Struct({
    externalId: Schema.String,
    /** hh's id of the user logged in on the page (`hhid` of its state); picks the account. */
    hhid: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: BrowserDrafts,
  error: ApiError
})

/**
 * The operator pressed hh's own button in the browser and hh showed the
 * result. `submit`: the response was sent; `letter`: a letter was added to a
 * response hh already holds. The cloud checks `evidence` (the page markup after
 * the click) itself and stores what was on the form. Never queues a browser job.
 */
export const ApplicationsRecordBrowserSubmit = Rpc.make("ApplicationsRecordBrowserSubmit", {
  payload: Schema.Struct({
    kind: Schema.Literals(["submit", "letter"]),
    externalId: Schema.String,
    /** hh's id of the user logged in on the page; names the account when otbor knows it. */
    hhid: Schema.optional(Schema.NullOr(Schema.String)),
    /** @deprecated The resume the form had selected, as hh titles it. Use `resumeExternalId`: ids, not titles. */
    resumeTitle: Schema.NullOr(Schema.String),
    /**
     * hh's id of the resume the response was sent with, read from hh's own list
     * of responses when the form named none (a one-click response). Stronger
     * than the title: titles repeat, ids do not.
     */
    resumeExternalId: Schema.optional(Schema.NullOr(Schema.String)),
    letter: Schema.NullOr(Schema.String),
    answers: Schema.Array(FormAnswer),
    formHash: Schema.NullOr(Schema.String),
    url: Schema.String,
    evidence: Schema.String
  }),
  success: BrowserSubmitResult,
  error: ApiError
})
