import type { ApiError, EvaluateBatchResult } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import { makeEvaluator, type EvaluateBatchInput } from "./decisionEvaluation.ts"

export interface EvaluationRunnerShape {
  /**
   * Decides every vacancy of `userId` that lacks a current decision. Takes the
   * user explicitly because the worker runs schedules for their owner, not for
   * the process-wide `CurrentUser`.
   */
  readonly evaluateBatch: (
    userId: string,
    input?: EvaluateBatchInput
  ) => Effect.Effect<EvaluateBatchResult, ApiError>
}

/** Worker-side entry to the batch evaluation, used by chaining and the `evaluate` schedule. */
export class EvaluationRunner extends Context.Service<EvaluationRunner, EvaluationRunnerShape>()(
  "otbor/cloud/EvaluationRunner"
) {
  static readonly layer = Layer.effect(
    EvaluationRunner,
    Effect.gen(function*() {
      const evaluator = makeEvaluator(yield* Database)
      return EvaluationRunner.of({
        evaluateBatch: (userId, input = {}) => evaluator.evaluateBatch(userId, input)
      })
    })
  )
}
