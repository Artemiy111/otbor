import { Schema } from "effect"
import { HarnessJobId, PresetId, ResumeId, VacancyId } from "./ids.ts"
import { DecisionRecord } from "./models.ts"

/**
 * The model's (or an external agent's) verdict on how well one resume fits one
 * vacancy. Gate G2 of the pipeline: it never decides whether a vacancy is the
 * right role (the title gate does that), only how strong the match is among
 * vacancies that already passed the gate.
 */
export const FitVerdict = Schema.Literals(["strong", "ok", "weak", "no"])
export type FitVerdict = typeof FitVerdict.Type

const Percent = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })))
const Unit = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))

export const FitJudgement = Schema.Struct({
  /** 0..100. Replaces the deterministic fit in the decision. */
  fit: Percent,
  /** 0..1, how sure the judge is. Informational; never gates a decision. */
  confidence: Unit,
  verdict: FitVerdict,
  /** Why the resume does or does not fit, one short sentence each. */
  reasons: Schema.Array(Schema.String),
  /** Must-have requirements the resume demonstrably lacks. */
  disqualifiers: Schema.Array(Schema.String),
  /** Verbatim fragments of the vacancy or resume the reasons rely on. */
  quotes: Schema.Array(Schema.String)
})
export type FitJudgement = typeof FitJudgement.Type

/** `llm`: produced by an inference job. `external`: supplied by a chat agent over MCP/RPC. */
export const FitJudgementSource = Schema.Literals(["llm", "external"])
export type FitJudgementSource = typeof FitJudgementSource.Type

export const FitJudgementStatus = Schema.Literals(["pending", "done", "failed"])
export type FitJudgementStatus = typeof FitJudgementStatus.Type

export const FitJudgementRecord = Schema.Struct({
  id: Schema.String,
  vacancyId: VacancyId,
  resumeId: ResumeId,
  vacancyContentHash: Schema.String,
  resumeHash: Schema.String,
  promptVersion: Schema.String,
  source: FitJudgementSource,
  status: FitJudgementStatus,
  /** Present once `status` is `done`. */
  judgement: Schema.NullOr(FitJudgement),
  model: Schema.NullOr(Schema.String),
  inferenceJobId: Schema.NullOr(HarnessJobId),
  error: Schema.NullOr(Schema.String),
  /**
   * `true` when the vacancy content, the resume and the prompt version all
   * match what the judgement was made for. A stale judgement is kept and
   * shown, but the decision no longer uses it.
   */
  current: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type FitJudgementRecord = typeof FitJudgementRecord.Type

export const FitEnqueueResult = Schema.Struct({
  resumeId: ResumeId,
  enqueued: Schema.Int,
  /** Eligible vacancies left after this call (bounded by `limit`). */
  remaining: Schema.Int,
  jobs: Schema.Array(Schema.Struct({ vacancyId: VacancyId, jobId: HarnessJobId }))
})
export type FitEnqueueResult = typeof FitEnqueueResult.Type

export const FitSaveResult = Schema.Struct({
  judgement: FitJudgementRecord,
  decision: DecisionRecord
})
export type FitSaveResult = typeof FitSaveResult.Type

export const FitEnqueueInput = Schema.Struct({
  /** Jobs per call; default 25, at most 200. */
  limit: Schema.optional(Schema.Int),
  presetId: Schema.optional(PresetId),
  /** Default: the user's active resume. */
  resumeId: Schema.optional(ResumeId),
  /** Default `true`: only vacancies whose latest decision is `apply`. */
  onlyApply: Schema.optional(Schema.Boolean),
  /** Re-judge vacancies that already have a current judgement. */
  force: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String)
})
export type FitEnqueueInput = typeof FitEnqueueInput.Type
