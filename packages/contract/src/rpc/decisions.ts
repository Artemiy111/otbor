import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HhAccountId, PresetId, VacancyId } from "../ids.ts"
import { DecisionRecord, EvaluateBatchResult, PresetFilter } from "../models/index.ts"

export const DecisionsList = Rpc.make("DecisionsList", {
  payload: Schema.Struct({
    verdict: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** Default `created`: newest decision first. `priority`: best first. */
    orderBy: Schema.optional(Schema.Literals(["priority", "created"])),
    /** Only decisions with `fit >= minFit`. */
    minFit: Schema.optional(Schema.Int),
    /** Only vacancies matched by this preset's filter. */
    presetId: Schema.optional(PresetId),
    /** Only decisions made for this hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    /** Collapse history: keep the newest decision per vacancy and account. */
    latestPerVacancy: Schema.optional(Schema.Boolean),
    /** Only decisions with `fit <= maxFit`. */
    maxFit: Schema.optional(Schema.Int),
    /**
     * Ad-hoc vacancy filter, evaluated by the same SQL builder as presets and
     * ANDed with `presetId` when both are given.
     */
    filter: Schema.optional(PresetFilter),
    /**
     * Overrides `orderBy` when set. `priority` best first, `fit` highest fit,
     * `newest` newest published vacancy, `salary` highest salary (mixed
     * currencies are not converted), `random` a random sample.
     */
    sort: Schema.optional(Schema.Literals(["priority", "fit", "newest", "salary", "random"]))
  }),
  success: Schema.Array(DecisionRecord),
  error: ApiError
})

/**
 * Evaluates the vacancies that have no current decision: none at all, or one
 * made for older vacancy content, or policy version. Bounded by `limit`;
 * call again while `remaining > 0`.
 */
export const DecisionsEvaluateBatch = Rpc.make("DecisionsEvaluateBatch", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    /** Explicit account; omitted uses the user's default hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    resumeId: Schema.optional(Schema.String),
    /** Re-evaluate even when the current decision is fresh. */
    force: Schema.optional(Schema.Boolean),
    /** Restrict the batch to these vacancies. */
    vacancyIds: Schema.optional(Schema.Array(VacancyId)),
    includeBlacklisted: Schema.optional(Schema.Boolean)
  }),
  success: EvaluateBatchResult,
  error: ApiError
})
