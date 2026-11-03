import type { ApiError, HhAccountId, HhAccountRecord, HhSessionState } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
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
                areaName: input.areaName
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

      return HhAccountService.of({ list, upsert, setSession, remove, findById })
    })
  )
}
