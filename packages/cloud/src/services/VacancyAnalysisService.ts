import type { ApiError, VacancyAnalysis, VacancyId } from "@otbor/contract"
import { ANALYSIS_PROMPT_VERSION } from "@otbor/domain"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as VacancyAnalysisRepository from "../repositories/VacancyAnalysisRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface VacancyAnalysisServiceShape {
  /** The stored analysis under the current prompt version, or null. */
  readonly get: (vacancyId: VacancyId) => Effect.Effect<VacancyAnalysis | null, ApiError>
}

export class VacancyAnalysisService extends Context.Service<
  VacancyAnalysisService,
  VacancyAnalysisServiceShape
>()("otbor/cloud/VacancyAnalysisService") {
  static readonly layer = Layer.effect(
    VacancyAnalysisService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const get: VacancyAnalysisServiceShape["get"] = Effect.fn("VacancyAnalysisService.get")(
        function*(vacancyId) {
          const row = yield* database
            .asUser(currentUser.userId, (tx) =>
              VacancyAnalysisRepository.get(tx, vacancyId, ANALYSIS_PROMPT_VERSION)
            )
            .pipe(Effect.mapError(toStorageError("vacancyAnalysis.get")))
          return row === null ? null : VacancyAnalysisRepository.toAnalysis(row)
        }
      )

      return VacancyAnalysisService.of({ get })
    })
  )
}
