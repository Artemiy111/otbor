import type { ApiError, KeywordMatchLocation, LexiconKeyword } from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface LexiconServiceShape {
  readonly lexiconList: (options: {
    readonly query?: string
    readonly limit?: number
    readonly presetId?: string
    readonly location?: KeywordMatchLocation
  }) => Effect.Effect<ReadonlyArray<LexiconKeyword>, ApiError>
  readonly lexiconUpsert: (input: {
    readonly id?: string
    readonly term: string
    readonly aliases?: ReadonlyArray<string>
  }) => Effect.Effect<LexiconKeyword, ApiError>
  readonly lexiconAliasAdd: (input: {
    readonly keywordId: string
    readonly alias: string
    readonly typo?: boolean
  }) => Effect.Effect<LexiconKeyword, ApiError>
  readonly lexiconAliasSetTypo: (input: {
    readonly id: string
    readonly typo: boolean
  }) => Effect.Effect<LexiconKeyword, ApiError>
  readonly lexiconAliasRemove: (id: string) => Effect.Effect<boolean, ApiError>
  readonly lexiconRemove: (id: string) => Effect.Effect<boolean, ApiError>
}
export class LexiconService extends Context.Service<LexiconService, LexiconServiceShape>()(
  "otbor/cloud/LexiconService"
) {
  static readonly layer = Layer.effect(
    LexiconService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const lexiconList: LexiconServiceShape["lexiconList"] = (options) =>
        Effect.gen(function*() {
          const presetId = options.presetId
          const preset = presetId === undefined
            ? null
            : yield* database
              .asUser(currentUser.userId, (tx) =>
                PresetRepository.findById(tx, presetId, currentUser.userId)
              )
              .pipe(Effect.mapError(toStorageError("lexicon.list")))

          if (presetId !== undefined && preset === null) {
            return yield* new NotFound({ entity: "Preset", id: presetId })
          }

          const filter = preset !== null
            ? {
                ...preset.filter,
                ...(options.location === undefined ? {} : { location: options.location })
              }
            : options.location === undefined
              ? undefined
              : { location: options.location }

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              LexiconRepository.list(tx, {
                query: options.query,
                limit: options.limit,
                filter,
                userId: currentUser.userId
              })
            )
            .pipe(Effect.mapError(toStorageError("lexicon.list")))
        })

      const lexiconUpsert: LexiconServiceShape["lexiconUpsert"] = (input) =>
        database
          .asOwner((tx) => LexiconRepository.upsert(tx, input))
          .pipe(Effect.mapError(toStorageError("lexicon.upsert")))

      const lexiconAliasAdd: LexiconServiceShape["lexiconAliasAdd"] = (input) =>
        database
          .asOwner((tx) => LexiconRepository.addAlias(tx, input))
          .pipe(Effect.mapError(toStorageError("lexicon.aliasAdd")))

      const lexiconAliasSetTypo: LexiconServiceShape["lexiconAliasSetTypo"] = (input) =>
        database
          .asOwner((tx) => LexiconRepository.setAliasTypo(tx, input))
          .pipe(Effect.mapError(toStorageError("lexicon.aliasSetTypo")))

      const lexiconAliasRemove: LexiconServiceShape["lexiconAliasRemove"] = (id) =>
        database
          .asOwner((tx) => LexiconRepository.removeAlias(tx, id))
          .pipe(Effect.mapError(toStorageError("lexicon.aliasRemove")))

      const lexiconRemove: LexiconServiceShape["lexiconRemove"] = (id) =>
        database
          .asOwner((tx) => LexiconRepository.remove(tx, id))
          .pipe(Effect.mapError(toStorageError("lexicon.remove")))

      return LexiconService.of({
        lexiconList,
        lexiconUpsert,
        lexiconAliasAdd,
        lexiconAliasSetTypo,
        lexiconAliasRemove,
        lexiconRemove
      })
    })
  )
}
