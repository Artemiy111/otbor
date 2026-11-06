import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApplySort, AutoMode, SortDirection, TestsPolicy } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { ApplicationId, HhAccountId, PresetId, ResumeId } from "../ids.ts"
import {
  ApplyBoost,
  ApplyFilterRecord,
  ApplyFilterView,
  ApplyUsage,
  AutoApplyPreviewResult,
  AutoApplyProgressResult,
  AutoApplyRetryResult,
  PresetFilter
} from "../models/index.ts"

/**
 * The filter that applies to (account, resume): the exact row, else the
 * account row (resume null), else the built-in default. `source` says which.
 */
export const ApplyFilterGet = Rpc.make("ApplyFilterGet", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId)
  }),
  success: ApplyFilterView,
  error: ApiError
})

/**
 * Upserts the row for exactly (account, resume). Settings left out keep their
 * stored value (defaults on first save). `templatePresetId` is kept unless given.
 */
export const ApplyFilterSet = Rpc.make("ApplyFilterSet", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId),
    filter: PresetFilter,
    minFit: Schema.optional(Schema.Int),
    tests: Schema.optional(TestsPolicy),
    freshHalfLifeHours: Schema.optional(Schema.Int),
    autoMode: Schema.optional(AutoMode),
    dailyLimit: Schema.optional(Schema.Int),
    batchSize: Schema.optional(Schema.Int),
    sort: Schema.optional(ApplySort),
    sortDirection: Schema.optional(SortDirection),
    minPriority: Schema.optional(Schema.Number),
    boosts: Schema.optional(Schema.Array(ApplyBoost)),
    /** Left out keeps the stored value; `null` or a blank string clears it (harness default). */
    writingHarness: Schema.optional(Schema.NullOr(Schema.String)),
    writingModel: Schema.optional(Schema.NullOr(Schema.String)),
    writingEffort: Schema.optional(Schema.NullOr(Schema.String)),
    templatePresetId: Schema.optional(Schema.NullOr(PresetId))
  }),
  success: ApplyFilterRecord,
  error: ApiError
})

/** Responses used and left in the rolling 24 hours of one hh account. */
export const ApplyUsageGet = Rpc.make("ApplyUsageGet", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: ApplyUsage,
  error: ApiError
})

/**
 * Read-only: what the next auto-apply run would take for (account, resume)
 * under the settings that apply (exact row, else account row, else default).
 * Answers even when `autoMode` is `off`.
 */
export const AutoApplyPreview = Rpc.make("AutoApplyPreview", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId)
  }),
  success: AutoApplyPreviewResult,
  error: ApiError
})

/**
 * Read-only: where the applications of the auto-apply runner stand (form read,
 * writing, kit, submit), newest first, plus counts of the last 3 days.
 */
export const AutoApplyProgress = Rpc.make("AutoApplyProgress", {
  payload: Schema.Struct({
    hhAccountId: Schema.optional(HhAccountId),
    limit: Schema.optional(Schema.Int),
    activeOnly: Schema.optional(Schema.Boolean)
  }),
  success: AutoApplyProgressResult,
  error: ApiError
})

/**
 * Retries the cover letter of auto applications whose writing job died: frees
 * the job's idempotency slot and puts the application back for the next runner
 * tick. One application, or all retryable ones of the account (or of the user).
 * Never touches manual applications or anything that may have been sent.
 */
export const AutoApplyRetry = Rpc.make("AutoApplyRetry", {
  payload: Schema.Struct({
    applicationId: Schema.optional(ApplicationId),
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: AutoApplyRetryResult,
  error: ApiError
})

/** Copies the preset's filter into the row for (account, resume); settings stay. */
export const ApplyFilterFromPreset = Rpc.make("ApplyFilterFromPreset", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId),
    presetId: PresetId
  }),
  success: ApplyFilterRecord,
  error: ApiError
})
