import type { ApiError, Overview } from "@otbor/contract"
import { Config, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as OverviewRepository from "../repositories/OverviewRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { DEFAULT_DAILY_APPLY_LIMIT } from "./dailyLimit.ts"
import { toStorageError } from "./support.ts"

export interface OverviewServiceShape {
  /** Снимок для главной страницы; `days` по умолчанию 14, зажимается в 1..60. */
  readonly get: (input: { readonly days?: number | undefined }) => Effect.Effect<Overview, ApiError>
}

/** Окно по умолчанию, сутки. */
export const OVERVIEW_DEFAULT_DAYS = 14
/** Максимальное окно, сутки. */
export const OVERVIEW_MAX_DAYS = 60

export class OverviewService extends Context.Service<OverviewService, OverviewServiceShape>()(
  "otbor/cloud/OverviewService"
) {
  /** Лимит по умолчанию читается из `OTBOR_DAILY_APPLY_LIMIT`, как у раннера и очереди. */
  static readonly layer = Layer.effect(
    OverviewService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const fallbackDailyLimit = yield* Config.Int("OTBOR_DAILY_APPLY_LIMIT").pipe(
        Config.withDefault(DEFAULT_DAILY_APPLY_LIMIT)
      )

      const get: OverviewServiceShape["get"] = Effect.fn("OverviewService.get")(function*(input) {
        const days = Math.min(Math.max(Math.trunc(input.days ?? OVERVIEW_DEFAULT_DAYS), 1), OVERVIEW_MAX_DAYS)
        return yield* database
          .asUser(currentUser.userId, (tx) =>
            OverviewRepository.snapshot(tx, currentUser.userId, {
              days,
              fallbackDailyLimit,
              now: new Date()
            })
          )
          .pipe(Effect.mapError(toStorageError("overview.get")))
      })

      return OverviewService.of({ get })
    })
  )
}
