import type {
  ApiError,
  BlacklistRecord,
  BlacklistScope,
  BlacklistTarget
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as BlacklistRepository from "../repositories/BlacklistRepository.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface BlacklistServiceShape {
  readonly list: (filter: BlacklistRepository.BlacklistFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<BlacklistRecord>; readonly total: number },
    ApiError
  >
  readonly upsert: (input: {
    readonly id?: string
    readonly scope: BlacklistScope
    readonly hhAccountId?: string
    readonly targetType: BlacklistTarget
    readonly externalId: string
    readonly name?: string
    readonly reason?: string
  }) => Effect.Effect<BlacklistRecord, ApiError>
  readonly remove: (id: string) => Effect.Effect<boolean, ApiError>
  readonly importHh: (input: {
    readonly hhAccountId: string
    readonly entries: ReadonlyArray<{
      readonly targetType: BlacklistTarget
      readonly externalId: string
      readonly name?: string
    }>
  }) => Effect.Effect<
    { readonly imported: number; readonly updated: number; readonly skipped: number },
    ApiError
  >
}

const accountExists = (tx: Executor, userId: string, accountId: string) =>
  HhAccountRepository.find(tx, userId, accountId).pipe(Effect.map((row) => row !== null))

export class BlacklistService extends Context.Service<BlacklistService, BlacklistServiceShape>()(
  "otbor/cloud/BlacklistService"
) {
  static readonly layer = Layer.effect(
    BlacklistService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: BlacklistServiceShape["list"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) => BlacklistRepository.list(tx, filter))
          .pipe(Effect.mapError(toStorageError("blacklist.list")))

      const upsert: BlacklistServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const invalid = BlacklistRepository.validateInput({
            scope: input.scope,
            hhAccountId: input.hhAccountId,
            externalId: input.externalId
          })
          if (invalid !== null) {
            return yield* new InvalidInput({ message: invalid })
          }

          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (input.scope !== "app" && input.hhAccountId !== undefined) {
                  const exists = yield* accountExists(
                    tx,
                    currentUser.userId,
                    input.hhAccountId
                  )
                  if (!exists) return null
                }
                return yield* BlacklistRepository.upsert(tx, {
                  userId: currentUser.userId,
                  id: input.id,
                  scope: input.scope,
                  hhAccountId: input.scope === "app" ? null : input.hhAccountId ?? null,
                  targetType: input.targetType,
                  externalId: input.externalId,
                  name: input.name ?? null,
                  reason: input.reason ?? null
                })
              })
            )
            .pipe(Effect.mapError(toStorageError("blacklist.upsert")))

          if (record === null) {
            return yield* new NotFound({
              entity: "HhAccount",
              id: input.hhAccountId ?? ""
            })
          }
          return record
        })

      const remove: BlacklistServiceShape["remove"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) => BlacklistRepository.remove(tx, id))
          .pipe(Effect.mapError(toStorageError("blacklist.remove")))

      const importHh: BlacklistServiceShape["importHh"] = (input) =>
        Effect.gen(function*() {
          const result = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const exists = yield* accountExists(tx, currentUser.userId, input.hhAccountId)
                if (!exists) return null
                return yield* BlacklistRepository.importHh(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  entries: input.entries
                })
              })
            )
            .pipe(Effect.mapError(toStorageError("blacklist.importHh")))

          if (result === null) {
            return yield* new NotFound({ entity: "HhAccount", id: input.hhAccountId })
          }
          return result
        })

      return BlacklistService.of({ list, upsert, remove, importHh })
    })
  )
}
