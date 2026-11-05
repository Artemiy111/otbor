import type { ApiError, ApplyFilterRecord, ApplyFilterView, PresetFilter } from "@otbor/contract"
import {
  APPLY_BOOST_WEIGHT_MAX,
  APPLY_BOOST_WEIGHT_MIN,
  InvalidInput,
  NotFound,
  parseBoosts,
  parsePresetFilter
} from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ApplyFilterTarget {
  readonly hhAccountId: string
  readonly resumeId?: string | null
}

export interface ApplyFilterSetInput extends ApplyFilterTarget {
  readonly filter: PresetFilter
  readonly minFit?: number
  readonly tests?: ApplyFilterRecord["tests"]
  readonly freshHalfLifeHours?: number
  readonly autoMode?: ApplyFilterRecord["autoMode"]
  readonly dailyLimit?: number
  readonly batchSize?: number
  readonly sort?: ApplyFilterRecord["sort"]
  readonly sortDirection?: ApplyFilterRecord["sortDirection"]
  readonly minPriority?: number
  readonly boosts?: ApplyFilterRecord["boosts"]
  readonly templatePresetId?: string | null
}

export interface ApplyFilterServiceShape {
  /** The filter that applies: exact row, else account row, else the built-in default. */
  readonly get: (target: ApplyFilterTarget) => Effect.Effect<ApplyFilterView, ApiError>
  readonly set: (input: ApplyFilterSetInput) => Effect.Effect<ApplyFilterRecord, ApiError>
  /** Copies the preset's filter into the pair's row; the settings stay. */
  readonly fromPreset: (
    input: ApplyFilterTarget & { readonly presetId: string }
  ) => Effect.Effect<ApplyFilterRecord, ApiError>
}

export class ApplyFilterService extends Context.Service<ApplyFilterService, ApplyFilterServiceShape>()(
  "otbor/cloud/ApplyFilterService"
) {
  static readonly layer = Layer.effect(
    ApplyFilterService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const userId = currentUser.userId

      const requireTarget = (tx: Executor, target: ApplyFilterTarget) =>
        Effect.gen(function*() {
          const exists = yield* ApplyFilterRepository.targetExists(
            tx,
            target.hhAccountId,
            target.resumeId ?? null
          )
          if (!exists.account) return yield* new NotFound({ entity: "HhAccount", id: target.hhAccountId })
          if (!exists.resume) return yield* new NotFound({ entity: "Resume", id: target.resumeId ?? "" })
        })

      const validate = (input: {
        readonly minFit?: number
        readonly freshHalfLifeHours?: number
        readonly dailyLimit?: number
        readonly batchSize?: number
        readonly sortDirection?: ApplyFilterRecord["sortDirection"]
        readonly minPriority?: number
        readonly boosts?: ApplyFilterRecord["boosts"]
      }) =>
        Effect.gen(function*() {
          if (input.minFit !== undefined && (input.minFit < 0 || input.minFit > 100)) {
            return yield* new InvalidInput({ message: "minFit must be between 0 and 100" })
          }
          if (input.freshHalfLifeHours !== undefined && input.freshHalfLifeHours < 1) {
            return yield* new InvalidInput({ message: "freshHalfLifeHours must be at least 1" })
          }
          if (input.dailyLimit !== undefined && (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 0)) {
            return yield* new InvalidInput({ message: "dailyLimit must be an integer, 0 or more" })
          }
          if (
            input.batchSize !== undefined &&
            (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 500)
          ) {
            return yield* new InvalidInput({ message: "batchSize must be between 1 and 500" })
          }
          if (input.sortDirection !== undefined && input.sortDirection !== "desc" && input.sortDirection !== "asc") {
            return yield* new InvalidInput({ message: "sortDirection must be desc or asc" })
          }
          if (input.minPriority !== undefined && !(Number.isFinite(input.minPriority) && input.minPriority >= 0)) {
            return yield* new InvalidInput({ message: "minPriority must be 0 or more" })
          }
          for (const boost of input.boosts ?? []) {
            if (boost.weight < APPLY_BOOST_WEIGHT_MIN || boost.weight > APPLY_BOOST_WEIGHT_MAX) {
              return yield* new InvalidInput({
                message: `boost weight must be between ${APPLY_BOOST_WEIGHT_MIN} and ${APPLY_BOOST_WEIGHT_MAX}`
              })
            }
          }
        })

      const get: ApplyFilterServiceShape["get"] = (target) =>
        database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              yield* requireTarget(tx, target)
              const resolved = yield* ApplyFilterRepository.resolve(
                tx,
                userId,
                target.hhAccountId,
                target.resumeId ?? null
              )
              return {
                ...resolved,
                id: resolved.id as ApplyFilterView["id"],
                hhAccountId: target.hhAccountId as ApplyFilterView["hhAccountId"],
                resumeId: (target.resumeId ?? null) as ApplyFilterView["resumeId"],
                templatePresetId: resolved.templatePresetId as ApplyFilterView["templatePresetId"]
              } satisfies ApplyFilterView
            })
          )
          .pipe(Effect.mapError(toStorageErrorUnlessApi("applyFilter.get")))

      const set: ApplyFilterServiceShape["set"] = (input) =>
        Effect.gen(function*() {
          yield* validate(input)
          return yield* database
            .asUser(userId, (tx) =>
              Effect.gen(function*() {
                yield* requireTarget(tx, input)
                return yield* ApplyFilterRepository.upsert(tx, {
                  userId,
                  hhAccountId: input.hhAccountId,
                  resumeId: input.resumeId ?? null,
                  filter: parsePresetFilter(input.filter),
                  minFit: input.minFit,
                  tests: input.tests,
                  freshHalfLifeHours: input.freshHalfLifeHours,
                  autoMode: input.autoMode,
                  dailyLimit: input.dailyLimit,
                  batchSize: input.batchSize,
                  sort: input.sort,
                  sortDirection: input.sortDirection,
                  minPriority: input.minPriority,
                  boosts: input.boosts === undefined ? undefined : parseBoosts(input.boosts),
                  templatePresetId: input.templatePresetId
                })
              })
            )
            .pipe(Effect.mapError(toStorageErrorUnlessApi("applyFilter.set")))
        })

      const fromPreset: ApplyFilterServiceShape["fromPreset"] = (input) =>
        database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              yield* requireTarget(tx, input)
              const preset = yield* PresetRepository.findById(tx, input.presetId, userId)
              if (preset === null) return yield* new NotFound({ entity: "Preset", id: input.presetId })
              return yield* ApplyFilterRepository.upsert(tx, {
                userId,
                hhAccountId: input.hhAccountId,
                resumeId: input.resumeId ?? null,
                filter: preset.filter,
                templatePresetId: preset.id
              })
            })
          )
          .pipe(Effect.mapError(toStorageErrorUnlessApi("applyFilter.fromPreset")))

      return ApplyFilterService.of({ get, set, fromPreset })
    })
  )
}

/** Typed API errors raised inside a transaction pass through; anything else is storage. */
const toStorageErrorUnlessApi =
  (operation: string) =>
  (cause: unknown): ApiError =>
    typeof cause === "object" && cause !== null && "_tag" in cause &&
      (cause._tag === "NotFound" || cause._tag === "InvalidInput" || cause._tag === "Conflict")
      ? (cause as ApiError)
      : toStorageError(operation)(cause)
