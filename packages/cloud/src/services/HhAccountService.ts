import type { ApiError, CaptchaEpisode, CaptchaModelStat, CaptchaSolveRecord, HhAccountId, HhAccountRecord, HhSessionState } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as CaptchaAttemptRepository from "../repositories/CaptchaAttemptRepository.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
import * as SubmitPacingRepository from "../repositories/SubmitPacingRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface HhAccountUpsertInput {
  readonly id?: HhAccountId
  readonly label: string
  readonly isDefault?: boolean
  readonly sessionProfile?: string | null
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly areaName?: string | null
  readonly color?: string | null
}

export interface HhAccountServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<HhAccountRecord>, ApiError>
  readonly upsert: (input: HhAccountUpsertInput) => Effect.Effect<HhAccountRecord, ApiError>
  readonly setSession: (input: {
    readonly id: HhAccountId
    readonly state: HhSessionState
    readonly error?: string | null
  }) => Effect.Effect<HhAccountRecord, ApiError>
  readonly remove: (
    id: string
  ) => Effect.Effect<{ readonly id: HhAccountId; readonly deleted: boolean }, ApiError>
  readonly findById: (id: string) => Effect.Effect<HhAccountRecord | null, ApiError>
  /**
   * Оператор решил капчу: снимает блокировку отправок и освобождает автозаявки,
   * ждавшие её. `applicationIds` раннер двигает сразу.
   */
  readonly resumeSubmits: (id: string) => Effect.Effect<
    { readonly account: HhAccountRecord; readonly applicationIds: ReadonlyArray<string> },
    ApiError
  >
  /** Журнал распознавания капчи моделью: последние капчи и сводка по моделям. */
  readonly captchaSolves: (input: {
    readonly hhAccountId?: string | undefined
    readonly limit?: number | undefined
  }) => Effect.Effect<
    { readonly solves: ReadonlyArray<CaptchaSolveRecord>; readonly models: ReadonlyArray<CaptchaModelStat> },
    ApiError
  >
  /** Последние эпизоды капчи, новые первыми. */
  readonly captchaEpisodes: (input: {
    readonly hhAccountId?: string | undefined
    readonly limit?: number | undefined
  }) => Effect.Effect<ReadonlyArray<CaptchaEpisode>, ApiError>
}

export class HhAccountService extends Context.Service<HhAccountService, HhAccountServiceShape>()(
  "otbor/cloud/HhAccountService"
) {
  static readonly layer = Layer.effect(
    HhAccountService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: HhAccountServiceShape["list"] = () =>
        database
          .asUser(currentUser.userId, (tx) =>
            HhAccountRepository.list(tx, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("hhAccount.list")))

      const upsert: HhAccountServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const label = input.label.trim()
          if (label === "") {
            return yield* new InvalidInput({ message: "hh account label must not be empty" })
          }
          if (input.color != null && !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
            return yield* new InvalidInput({ message: "hh account color must look like #rrggbb" })
          }

          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                // One session profile is one account: a second login with the
                // same profile updates the row instead of creating a twin.
                const twin =
                  input.id === undefined && input.sessionProfile != null
                    ? yield* HhAccountRepository.findBySessionProfile(
                        tx,
                        currentUser.userId,
                        input.sessionProfile
                      )
                    : null
                return yield* HhAccountRepository.upsert(tx, {
                userId: currentUser.userId,
                id: input.id ?? twin?.id ?? null,
                label,
                isDefault: input.isDefault ?? twin?.isDefault,
                sessionProfile: input.sessionProfile,
                firstName: input.firstName,
                lastName: input.lastName,
                areaName: input.areaName,
                color: input.color
                })
              })
            )
            .pipe(Effect.mapError(toStorageError("hhAccount.upsert")))

          return record
        })

      const remove: HhAccountServiceShape["remove"] = (id) =>
        Effect.gen(function*() {
          const deleted = yield* database
            .asUser(currentUser.userId, (tx) =>
              HhAccountRepository.remove(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("hhAccount.remove")))

          return { id: id as HhAccountId, deleted }
        })

      const setSession: HhAccountServiceShape["setSession"] = (input) =>
        Effect.gen(function*() {
          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              HhAccountRepository.setSession(tx, { userId: currentUser.userId, ...input })
            )
            .pipe(Effect.mapError(toStorageError("hhAccount.setSession")))
          if (record === null) {
            return yield* new NotFound({ entity: "HhAccount", id: input.id })
          }
          return record
        })

      const findById: HhAccountServiceShape["findById"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) =>
            HhAccountRepository.findById(tx, currentUser.userId, id)
          )
          .pipe(Effect.mapError(toStorageError("hhAccount.findById")))

      const resumeSubmits: HhAccountServiceShape["resumeSubmits"] = (id) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const existing = yield* HhAccountRepository.findById(tx, currentUser.userId, id)
                if (existing === null) return null
                const applicationIds = yield* SubmitPacingRepository.resume(tx, currentUser.userId, id)
                const account = yield* HhAccountRepository.findById(tx, currentUser.userId, id)
                return { account: account ?? existing, applicationIds }
              })
            )
            .pipe(Effect.mapError(toStorageError("hhAccount.resumeSubmits")))
          if (outcome === null) return yield* new NotFound({ entity: "HhAccount", id })
          return outcome
        })

      const captchaEpisodes: HhAccountServiceShape["captchaEpisodes"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) =>
            SubmitPacingRepository.episodes(tx, currentUser.userId, {
              hhAccountId: input.hhAccountId,
              limit: Math.min(Math.max(input.limit ?? 20, 1), 200)
            })
          )
          .pipe(Effect.mapError(toStorageError("hhAccount.captchaEpisodes")))

      const captchaSolves: HhAccountServiceShape["captchaSolves"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) =>
            CaptchaAttemptRepository.recent(tx, currentUser.userId, {
              hhAccountId: input.hhAccountId,
              limit: Math.min(Math.max(input.limit ?? 30, 1), 200)
            })
          )
          .pipe(Effect.mapError(toStorageError("hhAccount.captchaSolves")))

      return HhAccountService.of({ list, upsert, setSession, remove, findById, resumeSubmits, captchaEpisodes, captchaSolves })
    })
  )
}
