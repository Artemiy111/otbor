import type { ApiError, ContactId, ContactRecord } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ContactRepository from "../repositories/ContactRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ContactServiceShape {
  readonly list: (filter: ContactRepository.ContactFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<ContactRecord>; readonly total: number },
    ApiError
  >
  readonly remove: (
    id: string
  ) => Effect.Effect<{ readonly id: ContactId; readonly deleted: boolean }, ApiError>
  readonly extract: () => Effect.Effect<
    { readonly scanned: number; readonly contacts: number },
    ApiError
  >
}

/** Contacts are read and deleted from the request path; extraction writes them. */
export class ContactService extends Context.Service<ContactService, ContactServiceShape>()(
  "otbor/cloud/ContactService"
) {
  static readonly layer = Layer.effect(
    ContactService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: ContactServiceShape["list"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ContactRepository.list(tx, currentUser.userId, filter)
          )
          .pipe(Effect.mapError(toStorageError("contact.list")))

      const remove: ContactServiceShape["remove"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ContactRepository.remove(tx, currentUser.userId, id)
          )
          .pipe(
            Effect.mapError(toStorageError("contact.remove")),
            Effect.map((deleted) => ({ id: id as ContactId, deleted }))
          )

      const extract: ContactServiceShape["extract"] = () =>
        database
          .asUser(currentUser.userId, (tx) =>
            ContactRepository.extractFromVacancies(tx, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("contact.extract")))

      return ContactService.of({ list, remove, extract })
    })
  )
}
