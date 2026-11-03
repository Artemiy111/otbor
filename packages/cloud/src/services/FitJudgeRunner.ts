import type { ApiError, FitEnqueueInput, FitEnqueueResult } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import { makeFitJudge } from "./fitJudge.ts"

export interface FitJudgeRunnerShape {
  /**
   * Enqueues fit inference for `userId`. Takes the user explicitly because the
   * worker runs schedules for their owner, not for the process-wide
   * `CurrentUser`.
   */
  readonly enqueue: (
    userId: string,
    input?: FitEnqueueInput
  ) => Effect.Effect<FitEnqueueResult, ApiError>
}

/** Worker-side entry to fit enqueueing, used by the `fit` schedule kind. */
export class FitJudgeRunner extends Context.Service<FitJudgeRunner, FitJudgeRunnerShape>()(
  "otbor/cloud/FitJudgeRunner"
) {
  static readonly layer = Layer.effect(
    FitJudgeRunner,
    Effect.gen(function*() {
      const core = makeFitJudge(yield* Database)
      return FitJudgeRunner.of({
        enqueue: (userId, input = {}) => core.enqueue(userId, input)
      })
    })
  )
}
