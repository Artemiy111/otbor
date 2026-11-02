import type {
  ApiError,
  SyncResult,
  TelegramAccountId,
  TelegramAccountRecord
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  deleteAccountFiles,
  maskPhone,
  readAccountConfig,
  writeAccountConfig,
  writeAppConfig
} from "@otbor/telegram"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as TelegramRepository from "../repositories/TelegramRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import {
  TelegramSync,
  type TelegramLoginResult,
  type TelegramLoginStatusResult
} from "./TelegramSync.ts"
import { toStorageError } from "./support.ts"

export interface TelegramAccountUpsertInput {
  readonly id?: TelegramAccountId
  readonly label: string
  readonly apiId: number
  readonly apiHash: string
  readonly phone?: string
}

export interface TelegramServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<TelegramAccountRecord>, ApiError>
  readonly upsert: (
    input: TelegramAccountUpsertInput
  ) => Effect.Effect<TelegramAccountRecord, ApiError>
  readonly remove: (
    id: string
  ) => Effect.Effect<{ readonly id: TelegramAccountId; readonly deleted: boolean }, ApiError>
  readonly syncNow: (id: string) => Effect.Effect<SyncResult, ApiError>
  readonly loginQr: (id: string) => Effect.Effect<TelegramLoginResult, ApiError>
  readonly loginStatus: (id: string) => Effect.Effect<TelegramLoginStatusResult, ApiError>
}

/**
 * Telegram accounts are rows; the app hash and the MTProto session live in
 * `OTBOR_TELEGRAM_DIR`. Re-adding an account edits its label and phone but does
 * not overwrite the proxy already stored next to the session.
 */
export class TelegramService extends Context.Service<
  TelegramService,
  TelegramServiceShape
>()("otbor/cloud/TelegramService") {
  static readonly layer = Layer.effect(
    TelegramService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const sync = yield* TelegramSync

      const list: TelegramServiceShape["list"] = () =>
        database
          .asUser(currentUser.userId, (tx) =>
            TelegramRepository.list(tx, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("telegram.list")))

      const upsert: TelegramServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const label = input.label.trim()
          const apiHash = input.apiHash.trim()
          if (label === "") {
            return yield* new InvalidInput({
              message: "telegram account label must not be empty"
            })
          }
          if (!Number.isInteger(input.apiId) || input.apiId <= 0) {
            return yield* new InvalidInput({ message: "telegram api id is invalid" })
          }
          if (apiHash === "") {
            return yield* new InvalidInput({ message: "telegram api hash must not be empty" })
          }

          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              TelegramRepository.upsert(tx, {
                userId: currentUser.userId,
                id: input.id ?? null,
                label,
                phoneMasked: maskPhone(input.phone)
              })
            )
            .pipe(Effect.mapError(toStorageError("telegram.upsert")))

          yield* Effect.tryPromise({
            try: () => writeAppConfig({ apiId: input.apiId, apiHash }),
            catch: toStorageError("telegram.app.write")
          })

          const existing = yield* Effect.tryPromise({
            try: () => readAccountConfig(record.id),
            catch: toStorageError("telegram.account.read")
          })
          yield* Effect.tryPromise({
            try: () =>
              writeAccountConfig({
                id: record.id,
                phoneMasked: maskPhone(input.phone) ?? existing?.phoneMasked ?? null,
                proxy: existing?.proxy ?? null,
                createdAt: existing?.createdAt ?? new Date().toISOString()
              }),
            catch: toStorageError("telegram.account.write")
          })

          return record
        })

      const remove: TelegramServiceShape["remove"] = (id) =>
        Effect.gen(function*() {
          const deleted = yield* database
            .asUser(currentUser.userId, (tx) =>
              TelegramRepository.remove(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("telegram.remove")))

          if (deleted) {
            yield* Effect.tryPromise({
              try: () => deleteAccountFiles(id),
              catch: toStorageError("telegram.files.delete")
            }).pipe(Effect.ignore)
          }

          return { id: id as TelegramAccountId, deleted }
        })

      const syncNow: TelegramServiceShape["syncNow"] = (id) =>
        Effect.gen(function*() {
          const account = yield* database
            .asUser(currentUser.userId, (tx) =>
              TelegramRepository.find(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("telegram.sync")))
          if (account === null) {
            return yield* new NotFound({ entity: "TelegramAccount", id })
          }
          return yield* sync.sync(currentUser.userId, id)
        })

      const loginQr: TelegramServiceShape["loginQr"] = (id) =>
        sync.loginQr(currentUser.userId, id)

      const loginStatus: TelegramServiceShape["loginStatus"] = (id) =>
        sync.loginStatus(currentUser.userId, id)

      return TelegramService.of({ list, upsert, remove, syncNow, loginQr, loginStatus })
    })
  )
}
