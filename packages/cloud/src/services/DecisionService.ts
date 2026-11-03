import type { ApiError, DecisionRecord, EvaluateBatchResult } from "@otbor/contract"
import { NotFound, parsePresetFilter, type PresetFilter } from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import {
  makeEvaluator,
  type EvaluateBatchInput,
  type EvaluateInput
} from "./decisionEvaluation.ts"
import { toStorageError } from "./support.ts"

export type { EvaluateBatchInput, EvaluateInput } from "./decisionEvaluation.ts"

export interface DecisionListOptions {
  readonly verdict?: string
  readonly limit?: number
  readonly offset?: number
  readonly orderBy?: "priority" | "created"
  readonly minFit?: number
  readonly maxFit?: number
  readonly sort?: "priority" | "fit" | "newest" | "salary" | "random"
  /** Ad-hoc filter, ANDed with the preset's (same SQL builder). */
  readonly filter?: PresetFilter
  readonly presetId?: string
  readonly hhAccountId?: string
  readonly latestPerVacancy?: boolean
}

export interface DecisionServiceShape {
  readonly evaluate: (input: EvaluateInput) => Effect.Effect<DecisionRecord, ApiError>
  /** Evaluates vacancies lacking a current decision; see `isDecisionStale`. */
  readonly evaluateBatch: (
    input: EvaluateBatchInput
  ) => Effect.Effect<EvaluateBatchResult, ApiError>
  readonly list: (
    options: DecisionListOptions
  ) => Effect.Effect<ReadonlyArray<DecisionRecord>, ApiError>
}

export class DecisionService extends Context.Service<DecisionService, DecisionServiceShape>()(
  "otbor/cloud/DecisionService"
) {
  static readonly layer = Layer.effect(
    DecisionService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const evaluator = makeEvaluator(database)

      const list: DecisionServiceShape["list"] = (options) =>
        Effect.gen(function*() {
          const { presetId, filter, ...rest } = options

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                // The preset's own vacancy filter, applied to the decided vacancies.
                const parts: Array<SQL> = []
                if (presetId !== undefined) {
                  const preset = yield* PresetRepository.findById(tx, presetId, currentUser.userId)
                  if (preset === null) return null
                  parts.push(LexiconRepository.vacancyFilterSql(preset.filter, {
                    userId: currentUser.userId
                  }))
                }
                if (filter !== undefined) {
                  parts.push(LexiconRepository.vacancyFilterSql(parsePresetFilter(filter), {
                    userId: currentUser.userId
                  }))
                }
                const vacancyFilter = parts.length === 0
                  ? undefined
                  : sql.join(parts.map((p) => sql`(${p})`), sql` and `)
                return yield* DecisionRepository.list(tx, currentUser.userId, {
                  ...rest,
                  vacancyFilter
                })
              })
            )
            .pipe(
              Effect.mapError(toStorageError("decision.list")),
              Effect.flatMap((rows) =>
                rows === null
                  ? Effect.fail(new NotFound({ entity: "Preset", id: presetId ?? "" }))
                  : Effect.succeed(rows)
              )
            )
        })

      return DecisionService.of({
        evaluate: (input) => evaluator.evaluate(currentUser.userId, input),
        evaluateBatch: (input) => evaluator.evaluateBatch(currentUser.userId, input),
        list
      })
    })
  )
}
