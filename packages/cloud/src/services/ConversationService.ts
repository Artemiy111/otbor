import type { ApiError, ConversationDetail, ConversationSummary } from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ConversationServiceShape {
  readonly list: (
    filter: ConversationRepository.ConversationFilter
  ) => Effect.Effect<ReadonlyArray<ConversationSummary>, ApiError>
  readonly get: (id: string) => Effect.Effect<ConversationDetail, ApiError>
}

export class ConversationService extends Context.Service<
  ConversationService,
  ConversationServiceShape
>()("otbor/cloud/ConversationService") {
  static readonly layer = Layer.effect(
    ConversationService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: ConversationServiceShape["list"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ConversationRepository.list(tx, currentUser.userId, filter)
          )
          .pipe(Effect.mapError(toStorageError("conversation.list")))

      const get: ConversationServiceShape["get"] = (id) =>
        Effect.gen(function*() {
          const detail = yield* database
            .asUser(currentUser.userId, (tx) =>
              ConversationRepository.get(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("conversation.get")))

          if (detail === null) {
            return yield* new NotFound({ entity: "Conversation", id })
          }
          return detail
        })

      return ConversationService.of({ list, get })
    })
  )
}
