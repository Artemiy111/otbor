import type { ApiError, MarketAnalytics } from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as MarketRepository from "../repositories/MarketRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface MarketServiceShape {
  readonly analytics: (input: {
    readonly presetId?: string
    readonly sinceDays?: number
    readonly currency?: string
  }) => Effect.Effect<MarketAnalytics, ApiError>
}

export class MarketService extends Context.Service<MarketService, MarketServiceShape>()(
  "otbor/cloud/MarketService"
) {
  static readonly layer = Layer.effect(
    MarketService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const analytics: MarketServiceShape["analytics"] = Effect.fn("MarketService.analytics")(
        function*(input) {
          const presetId = input.presetId
          const preset = presetId === undefined
            ? null
            : yield* database
              .asUser(currentUser.userId, (tx) =>
                PresetRepository.findById(tx, presetId, currentUser.userId)
              )
              .pipe(Effect.mapError(toStorageError("market.preset")))
          if (presetId !== undefined && preset === null) {
            return yield* new NotFound({ entity: "Preset", id: presetId })
          }

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              MarketRepository.analytics(tx, {
                filter: preset?.filter,
                userId: currentUser.userId,
                sinceDays: input.sinceDays,
                currency: input.currency
              })
            )
            .pipe(Effect.mapError(toStorageError("market.analytics")))
        }
      )

      return MarketService.of({ analytics })
    })
  )
}
