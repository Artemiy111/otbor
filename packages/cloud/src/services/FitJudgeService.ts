import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { makeFitJudge, type FitJudgeCore } from "./fitJudge.ts"

type ForCurrentUser<Core> = {
  readonly [K in keyof Core]: Core[K] extends (userId: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never
}

export type FitJudgeServiceShape = ForCurrentUser<FitJudgeCore>

/**
 * Personal fit judgements for the request user: enqueue inference jobs for the
 * best undecided vacancies, store an externally produced judgement, read them
 * back. The model never runs here; see `completeFitInference` for the
 * completion path.
 */
export class FitJudgeService extends Context.Service<FitJudgeService, FitJudgeServiceShape>()(
  "otbor/cloud/FitJudgeService"
) {
  static readonly layer = Layer.effect(
    FitJudgeService,
    Effect.gen(function*() {
      const core = makeFitJudge(yield* Database)
      const currentUser = yield* CurrentUser
      const userId = currentUser.userId

      return FitJudgeService.of({
        enqueue: (input) => core.enqueue(userId, input),
        save: (input) => core.save(userId, input),
        get: (input) => core.get(userId, input),
        list: (options) => core.list(userId, options)
      })
    })
  )
}
