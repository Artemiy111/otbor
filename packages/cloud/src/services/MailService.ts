import type { ApiError, MailAccountId, MailAccountRecord, SyncResult } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { deleteAccountSecret, writeAccountSecret } from "@otbor/mail"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as MailRepository from "../repositories/MailRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { MailSync, type MailAccountTestResult } from "./MailSync.ts"
import { toStorageError } from "./support.ts"

export interface MailAccountUpsertInput {
  readonly id?: MailAccountId
  readonly label: string
  readonly address: string
  readonly host: string
  readonly port: number
  readonly secure?: boolean
  readonly username: string
  readonly password?: string
  readonly includeSent?: boolean
  readonly backfillDays?: number
  readonly enabled?: boolean
}

export interface MailServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<MailAccountRecord>, ApiError>
  readonly upsert: (input: MailAccountUpsertInput) => Effect.Effect<MailAccountRecord, ApiError>
  readonly remove: (
    id: string
  ) => Effect.Effect<{ readonly id: MailAccountId; readonly deleted: boolean }, ApiError>
  readonly test: (id: string) => Effect.Effect<MailAccountTestResult, ApiError>
  readonly syncNow: (id: string) => Effect.Effect<SyncResult, ApiError>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Account CRUD and the manual sync entry point. The password is written to the
 * local credential store (`OTBOR_MAIL_DIR`) by account id; the row keeps only a
 * `secret_ref`, and no RPC ever returns it.
 */
export class MailService extends Context.Service<MailService, MailServiceShape>()(
  "otbor/cloud/MailService"
) {
  static readonly layer = Layer.effect(
    MailService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const sync = yield* MailSync

      const list: MailServiceShape["list"] = () =>
        database
          .asUser(currentUser.userId, (tx) => MailRepository.list(tx, currentUser.userId))
          .pipe(Effect.mapError(toStorageError("mail.list")))

      const upsert: MailServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const label = input.label.trim()
          const address = input.address.trim().toLowerCase()
          const host = input.host.trim()
          const username = input.username.trim()
          const backfillDays = input.backfillDays ?? 90

          if (label === "") {
            return yield* new InvalidInput({ message: "mail account label must not be empty" })
          }
          if (!EMAIL.test(address)) {
            return yield* new InvalidInput({ message: "mail account address is not an email" })
          }
          if (host === "" || username === "") {
            return yield* new InvalidInput({
              message: "mail account host and username must not be empty"
            })
          }
          if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
            return yield* new InvalidInput({ message: "mail account port is invalid" })
          }
          if (!Number.isInteger(backfillDays) || backfillDays < 0) {
            return yield* new InvalidInput({
              message: "mail backfill days must be a non-negative integer"
            })
          }

          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              MailRepository.upsert(tx, {
                userId: currentUser.userId,
                id: input.id ?? null,
                label,
                address,
                host,
                port: input.port,
                secure: input.secure ?? true,
                username,
                includeSent: input.includeSent ?? false,
                backfillDays,
                enabled: input.enabled ?? true
              })
            )
            .pipe(Effect.mapError(toStorageError("mail.upsert")))

          if (input.password !== undefined) {
            const password = input.password
            if (password === "") {
              return yield* new InvalidInput({ message: "mail password must not be empty" })
            }
            yield* Effect.tryPromise({
              try: () =>
                writeAccountSecret(record.id, {
                  host: record.host,
                  port: record.port,
                  secure: record.secure,
                  username: record.username,
                  password
                }),
              catch: toStorageError("mail.secret.write")
            })
          }

          return record
        })

      const remove: MailServiceShape["remove"] = (id) =>
        Effect.gen(function*() {
          const deleted = yield* database
            .asUser(currentUser.userId, (tx) =>
              MailRepository.remove(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("mail.remove")))

          if (deleted) {
            yield* Effect.tryPromise({
              try: () => deleteAccountSecret(id),
              catch: toStorageError("mail.secret.delete")
            }).pipe(Effect.ignore)
          }

          return { id: id as MailAccountId, deleted }
        })

      const test: MailServiceShape["test"] = (id) => sync.test(currentUser.userId, id)

      const syncNow: MailServiceShape["syncNow"] = (id) =>
        Effect.gen(function*() {
          const account = yield* database
            .asUser(currentUser.userId, (tx) =>
              MailRepository.find(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("mail.sync")))
          if (account === null) {
            return yield* new NotFound({ entity: "MailAccount", id })
          }
          return yield* sync.sync(currentUser.userId, id)
        })

      return MailService.of({ list, upsert, remove, test, syncNow })
    })
  )
}
