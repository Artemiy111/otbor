import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import {
  FitEnqueueInput,
  FitEnqueueResult,
  FitJudgement,
  FitJudgementRecord,
  FitJudgementStatus,
  FitSaveResult
} from "../fit.ts"
import { ResumeId, VacancyId } from "../ids.ts"

/**
 * Picks the highest-priority decisions that lack a current judgement and
 * enqueues one inference job each. The answer arrives through the harness
 * completion path, which stores the judgement and re-decides the vacancy.
 */
export const FitJudgeEnqueue = Rpc.make("FitJudgeEnqueue", {
  payload: FitEnqueueInput,
  success: FitEnqueueResult,
  error: ApiError
})

/** The newest judgement for a vacancy (optionally for one resume), or null. */
export const FitJudgementGet = Rpc.make("FitJudgementGet", {
  payload: Schema.Struct({ vacancyId: VacancyId, resumeId: Schema.optional(ResumeId) }),
  success: Schema.NullOr(FitJudgementRecord),
  error: ApiError
})

export const FitJudgementsList = Rpc.make("FitJudgementsList", {
  payload: Schema.Struct({
    status: Schema.optional(FitJudgementStatus),
    resumeId: Schema.optional(ResumeId),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(FitJudgementRecord),
  error: ApiError
})

/**
 * Stores a judgement produced outside the harness (a chat agent over MCP) and
 * re-decides the vacancy with it, exactly like a finished inference job.
 */
export const FitJudgementSave = Rpc.make("FitJudgementSave", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    resumeId: Schema.optional(ResumeId),
    judgement: FitJudgement,
    model: Schema.optional(Schema.String)
  }),
  success: FitSaveResult,
  error: ApiError
})
