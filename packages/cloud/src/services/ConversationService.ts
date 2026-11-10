import type {
  ApiError,
  ConversationDetail,
  ConversationListItem,
  ConversationSearchResult,
  ConversationSummary
} from "@otbor/contract"
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
  /** Страница диалогов с серверным поиском, фильтрами и итогами. */
  readonly search: (
    filter: ConversationRepository.ConversationSearchFilter
  ) => Effect.Effect<ConversationSearchResult, ApiError>
  /** Только состояние otbor; почту, Telegram и hh не трогает. */
  readonly markRead: (id: string) => Effect.Effect<ConversationListItem, ApiError>
  readonly markUnread: (id: string) => Effect.Effect<ConversationListItem, ApiError>
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

      const search: ConversationServiceShape["search"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ConversationRepository.search(tx, currentUser.userId, filter)
          )
          .pipe(Effect.mapError(toStorageError("conversation.search")))

      const mark = (
        operation: "conversation.markRead" | "conversation.markUnread",
        write: typeof ConversationRepository.markRead
      ) =>
        (id: string): Effect.Effect<ConversationListItem, ApiError> =>
          Effect.gen(function*() {
            const updated = yield* database
              .asUser(currentUser.userId, (tx) =>
                Effect.gen(function*() {
                  const found = yield* write(tx, currentUser.userId, id)
                  return found ? yield* ConversationRepository.find(tx, currentUser.userId, id) : null
                })
              )
              .pipe(Effect.mapError(toStorageError(operation)))

            if (updated === null) {
              return yield* new NotFound({ entity: "Conversation", id })
            }
            return updated
          })

      return ConversationService.of({
        list,
        get,
        search,
        markRead: mark("conversation.markRead", ConversationRepository.markRead),
        markUnread: mark("conversation.markUnread", ConversationRepository.markUnread)
      })
    })
  )
}
