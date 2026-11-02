import type { ApiError, PresetFilter, PresetKind, PresetPreview, PresetRecord } from "@otbor/contract"
import { Conflict, emptyPresetFilter, parsePresetFilter } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface PresetServiceShape {
  readonly list: (options: { readonly kind?: string }) => Effect.Effect<
    ReadonlyArray<PresetRecord>,
    ApiError
  >
  readonly upsert: (input: {
    readonly id?: string
    readonly kind: PresetKind
    readonly title: string
    readonly filter?: PresetFilter
    readonly system?: boolean
  }) => Effect.Effect<PresetRecord, ApiError>
  readonly remove: (id: string) => Effect.Effect<boolean, ApiError>
  readonly preview: (filter: PresetFilter) => Effect.Effect<PresetPreview, ApiError>
}

export class PresetService extends Context.Service<PresetService, PresetServiceShape>()(
  "otbor/cloud/PresetService"
) {
  static readonly layer = Layer.effect(
    PresetService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: PresetServiceShape["list"] = (options) =>
        database
          .asUser(currentUser.userId, (tx) => PresetRepository.list(tx, options))
          .pipe(Effect.mapError(toStorageError("preset.list")))

      const upsert: PresetServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          if (input.title.trim() === "") {
            return yield* new Conflict({
              entity: "Preset",
              message: "title must not be empty"
            })
          }

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              PresetRepository.upsert(tx, {
                userId: currentUser.userId,
                id: input.id ?? null,
                kind: input.kind,
                title: input.title,
                filter: parsePresetFilter(input.filter ?? emptyPresetFilter),
                system: input.system ?? false
              })
            )
            .pipe(Effect.mapError(toStorageError("preset.upsert")))
        })

      const remove: PresetServiceShape["remove"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) =>
            PresetRepository.remove(tx, id, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("preset.remove")))

      const preview: PresetServiceShape["preview"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            PresetRepository.preview(tx, parsePresetFilter(filter), {
              userId: currentUser.userId
            })
          )
          .pipe(Effect.mapError(toStorageError("preset.preview")))

      return PresetService.of({ list, upsert, remove, preview })
    })
  )
}
