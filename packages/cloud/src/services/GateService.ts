import type {
  ApiError,
  GateVerdict,
  LexiconKeyword,
  RoleFamily,
  TitleGateResult,
  TitleVerdictRecord
} from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import { gateTitle, titleCacheKey } from "@otbor/domain"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface TitleVerdictInput {
  readonly title: string
  readonly verdict: GateVerdict
  readonly roleFamily?: string
}

export interface GateServiceShape {
  /** What the rules think, with an explicit user verdict taking precedence. */
  readonly preview: (title: string) => Effect.Effect<TitleGateResult, ApiError>
  /**
   * The only manual gate label. It is stored by normalized title, so the same
   * wording never asks the same question twice.
   */
  readonly setUserVerdict: (input: TitleVerdictInput) => Effect.Effect<TitleVerdictRecord, ApiError>
  readonly lexiconList: (options: {
    readonly query?: string
    readonly limit?: number
    readonly presetId?: string
  }) => Effect.Effect<ReadonlyArray<LexiconKeyword>, ApiError>
  readonly lexiconUpsert: (input: {
    readonly term: string
    readonly aliases?: ReadonlyArray<string>
    readonly enabled?: boolean
  }) => Effect.Effect<LexiconKeyword, ApiError>
  readonly lexiconRemove: (id: string) => Effect.Effect<boolean, ApiError>
}

export class GateService extends Context.Service<GateService, GateServiceShape>()(
  "otbor/cloud/GateService"
) {
  static readonly layer = Layer.effect(
    GateService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const preview: GateServiceShape["preview"] = (title) =>
        Effect.gen(function*() {
          const normalized = titleCacheKey(title)
          const cached = yield* database
            .asOwner((tx) => DecisionRepository.findVerdict(tx, normalized))
            .pipe(Effect.mapError(toStorageError("title.preview")))

          const rules = gateTitle(title)

          if (cached !== null) {
            return {
              title,
              titleNormalized: normalized,
              roleFamily: cached.roleFamily,
              verdict: cached.verdict,
              matched: cached.matched,
              rejectedBy: cached.rejectedBy,
              strong: rules.strong,
              weak: rules.weak,
              rulesVersion: cached.rulesVersion
            }
          }

          return {
            title,
            titleNormalized: normalized,
            roleFamily: rules.role,
            verdict: rules.verdict,
            matched: rules.matched,
            rejectedBy: rules.rejectedBy,
            strong: rules.strong,
            weak: rules.weak,
            rulesVersion: rules.rulesVersion
          }
        })

      const setUserVerdict: GateServiceShape["setUserVerdict"] = (input) =>
        Effect.gen(function*() {
          const normalized = titleCacheKey(input.title)
          if (normalized === "") {
            return yield* new NotFound({ entity: "Title", id: input.title })
          }

          const rules = gateTitle(input.title)
          const roleFamily = input.roleFamily ?? rules.role

          return yield* database
            .asOwner((tx) =>
              DecisionRepository.setUserVerdict(tx, {
                normalizedTitle: normalized,
                verdict: input.verdict,
                roleFamily: roleFamily as RoleFamily,
                matched: rules.matched
              })
            )
            .pipe(Effect.mapError(toStorageError("title.setUserVerdict")))
        })

      const lexiconList: GateServiceShape["lexiconList"] = (options) =>
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

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              LexiconRepository.list(tx, {
                query: options.query,
                limit: options.limit,
                filter: preset?.filter
              })
            )
            .pipe(Effect.mapError(toStorageError("lexicon.list")))
        })

      const lexiconUpsert: GateServiceShape["lexiconUpsert"] = (input) =>
        database
          .asOwner((tx) => LexiconRepository.upsert(tx, input))
          .pipe(Effect.mapError(toStorageError("lexicon.upsert")))

      const lexiconRemove: GateServiceShape["lexiconRemove"] = (id) =>
        database
          .asOwner((tx) => LexiconRepository.remove(tx, id))
          .pipe(Effect.mapError(toStorageError("lexicon.remove")))

      return GateService.of({
        preview,
        setUserVerdict,
        lexiconList,
        lexiconUpsert,
        lexiconRemove
      })
    })
  )
}
