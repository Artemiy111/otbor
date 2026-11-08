import type { ApiError, JobStatus, VacancyChat } from "@otbor/contract"
import { Conflict } from "@otbor/contract"
import type { ParsedChat } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { chatReadJob } from "./jobs.ts"
import { relinkConversations } from "./PersonService.ts"
import { toStorageError } from "./support.ts"

/**
 * The hh chat of a vacancy. hh keeps one chat per response, so a chat is
 * addressed by vacancy + resume (`application.hh_chat_id`). `refresh` only
 * enqueues a `chat_read` browser job; `QueueService.complete` parses the JSON
 * and calls `importChat`, which stores the messages as a `hh_chat`
 * conversation linked to the vacancy.
 */

const STAGE = "chat_read" as const
const ACTIVE: ReadonlyArray<JobStatus> = ["pending", "leased", "running"]

/** Stores the messages of a parsed chat. Idempotent by hh's message id. */
export const importChat = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly chat: ParsedChat
  }
): RepoEffect<{ readonly inserted: number; readonly updated: number }> =>
  Effect.gen(function*() {
    const { chat } = input
    const last = chat.messages.at(-1)
    const conversationId = yield* ConversationRepository.upsert(tx, {
      userId: input.userId,
      channel: "hh_chat",
      accountId: input.hhAccountId,
      externalId: chat.chatId,
      personName: chat.personName,
      lastMessageAt: last?.sentAt ?? null,
      raw: { vacancyExternalId: chat.vacancyExternalId, resumeExternalId: chat.resumeExternalId, hasMore: chat.hasMore }
    })
    yield* ConversationRepository.linkVacancy(tx, {
      userId: input.userId,
      conversationId,
      vacancyId: input.vacancyId,
      kind: "primary",
      source: "hh_chat"
    })
    const counts = yield* ConversationRepository.appendMessages(
      tx,
      input.userId,
      conversationId,
      chat.messages.map((message) => ({
        externalId: message.externalId,
        direction: message.direction,
        sentAt: message.sentAt,
        kind: message.kind,
        text: message.text
      }))
    )
    // Собеседник (имя из чата), контакты из входящих сообщений, человек и резюме
    // отклика (`application.hh_chat_id`) определяются перелинковкой диалога в этой же
    // транзакции. Стабильного id участника чата в ответе hh нет (`participantId`
    // относится к конкретному чату), поэтому `hh_chat` идентичностью не становится.
    yield* relinkConversations(tx, input.userId, conversationId)
    return counts
  })

/** Сколько чатов ставится в очередь за один проход по умолчанию. */
export const DEFAULT_CHAT_SYNC_LIMIT = 20
/** Через сколько часов сохранённый чат считается устаревшим. */
export const DEFAULT_CHAT_STALE_HOURS = 24

export interface ChatSyncAllOptions {
  /** Только этот аккаунт hh; иначе все аккаунты пользователя. */
  readonly hhAccountId?: string
  /** Не больше стольких заданий за проход. */
  readonly limit?: number
  /** Чат моложе этого возраста (по последнему чтению) не перечитывается. */
  readonly staleHours?: number
  readonly now?: Date
}

/**
 * Ставит `chat_read` для откликов с известным чатом, у которых нет свежей копии.
 * Пропускаются отклики с активным заданием и с заданием, поставленным позже
 * границы свежести (в том числе неудачным: упавший чат не долбится каждый тик).
 * Сначала идут чаты, которых ещё нет в базе, затем самые давние.
 */
export const enqueueChatReads = (
  tx: Executor,
  userId: string,
  options: ChatSyncAllOptions = {}
): RepoEffect<{ readonly queued: number; readonly candidates: number }> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_CHAT_SYNC_LIMIT), 1), 200)
    const staleHours = Math.max(options.staleHours ?? DEFAULT_CHAT_STALE_HOURS, 0)
    const cutoff = new Date((options.now ?? new Date()).getTime() - staleHours * 3_600_000)

    const rows = yield* tx.execute(sql`
      select distinct on (a.hh_account_id, a.hh_chat_id)
        a.hh_account_id::text as hh_account_id,
        a.vacancy_id::text as vacancy_id,
        a.hh_chat_id as chat_id,
        h.session_profile as session_profile,
        c.updated_at as fetched_at
      from application a
      join hh_account h on h.id = a.hh_account_id and h.user_id = ${userId}
      left join conversation c
        on c.user_id = a.user_id and c.channel = 'hh_chat'
       and c.account_id = a.hh_account_id::text and c.external_id = a.hh_chat_id
      where a.user_id = ${userId}
        and a.hh_chat_id is not null
        ${options.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${options.hhAccountId}::uuid`}
        and (c.id is null or c.updated_at < ${cutoff})
        and not exists (
          select 1 from harness_jobs j
          where j.hh_account_id = a.hh_account_id and j.stage = ${STAGE}
            and j.payload->>'chatId' = a.hh_chat_id
            and j.status <> 'cancelled'
            and (j.status in ('pending', 'leased', 'running') or j.created_at >= ${cutoff})
        )
      order by a.hh_account_id, a.hh_chat_id, a.updated_at desc
    `)
    const found = rows.rows as unknown as ReadonlyArray<{
      hh_account_id: string
      vacancy_id: string
      chat_id: string
      session_profile: string | null
      fetched_at: Date | string | null
    }>
    const ordered = [...found].sort((left, right) => {
      if (left.fetched_at === null && right.fetched_at !== null) return -1
      if (left.fetched_at !== null && right.fetched_at === null) return 1
      return new Date(left.fetched_at ?? 0).getTime() - new Date(right.fetched_at ?? 0).getTime()
    })

    let queued = 0
    for (const row of ordered.slice(0, limit)) {
      yield* chatReadJob(tx, {
        userId,
        hhAccountId: row.hh_account_id,
        vacancyId: row.vacancy_id,
        chatId: row.chat_id,
        sessionProfile: row.session_profile,
        sequence:
          (yield* QueueRepository.countForVacancy(tx, row.hh_account_id, row.vacancy_id, STAGE, row.chat_id)) + 1
      })
      queued += 1
    }
    return { queued, candidates: found.length }
  })

const fetchState = (status: JobStatus): VacancyChat["fetch"] => {
  switch (status) {
    case "pending":
      return "pending"
    case "leased":
    case "running":
      return "running"
    case "done":
      return "done"
    case "needs_human":
    case "needs_reconcile":
      return "needs_human"
    default:
      return "failed"
  }
}

export interface ChatKey {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId?: string | null
}

export interface ChatSyncShape {
  readonly get: (key: ChatKey) => Effect.Effect<VacancyChat, ApiError>
  readonly refresh: (key: ChatKey) => Effect.Effect<VacancyChat, ApiError>
  /**
   * Пакетная синхронизация чатов: ставит `chat_read` для откликов без свежей
   * копии чата (внутренний путь расписания `hh_chat_sync`, не RPC).
   */
  readonly syncAll: (
    userId: string,
    options?: ChatSyncAllOptions
  ) => Effect.Effect<{ readonly queued: number; readonly candidates: number }, ApiError>
}

/** The chat of the response made with this resume; a single response needs no resume. */
const chatIdIn = (tx: Executor, userId: string, key: ChatKey) =>
  tx
    .execute(sql`
      select resume_id::text as resume_id, hh_chat_id from application
      where user_id = ${userId} and hh_account_id = ${key.hhAccountId} and vacancy_id = ${key.vacancyId}
        and hh_chat_id is not null`)
    .pipe(
      Effect.map((result) => {
        const rows = result.rows as ReadonlyArray<{ resume_id: string | null; hh_chat_id: string }>
        const resumeId = key.resumeId ?? null
        const row =
          resumeId !== null
            ? rows.find((item) => item.resume_id === resumeId)
            : rows.length === 1
              ? rows[0]
              : undefined
        return row?.hh_chat_id ?? null
      })
    )

export class ChatSync extends Context.Service<ChatSync, ChatSyncShape>()("otbor/cloud/ChatSync") {
  static readonly layer = Layer.effect(
    ChatSync,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const viewIn = (tx: Executor, key: ChatKey, chatId: string | null) =>
        Effect.gen(function*() {
          if (chatId === null) {
            return { chatId, fetch: "none", message: null, fetchedAt: null, detail: null } satisfies VacancyChat
          }
          const conversationId = yield* ConversationRepository.findByExternal(tx, {
            userId: currentUser.userId,
            channel: "hh_chat",
            accountId: key.hhAccountId,
            externalId: chatId
          })
          const detail =
            conversationId === null
              ? null
              : yield* ConversationRepository.get(tx, currentUser.userId, conversationId)
          const latest = yield* QueueRepository.latestForVacancy(tx, key.hhAccountId, key.vacancyId, STAGE, chatId)
          return {
            chatId,
            fetch: latest === null ? "none" : fetchState(latest.job.status),
            message: latest?.lastError ?? null,
            fetchedAt:
              latest !== null && latest.job.status === "done" ? latest.updatedAt.toISOString() : null,
            detail
          } satisfies VacancyChat
        })

      const get: ChatSyncShape["get"] = (key) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              return yield* viewIn(tx, key, yield* chatIdIn(tx, currentUser.userId, key))
            })
          )
          .pipe(Effect.mapError(toStorageError("chat.get")))

      const refresh: ChatSyncShape["refresh"] = (key) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const chatId = yield* chatIdIn(tx, currentUser.userId, key)
              if (chatId === null) return { _tag: "nochat" } as const
              const running = (yield* HarnessRepository.statusList(tx)).some(
                (h) => h.online && h.kinds.includes("browser") && h.accounts.includes(key.hhAccountId)
              )
              if (!running) return { _tag: "offline" } as const
              const latest = yield* QueueRepository.latestForVacancy(tx, key.hhAccountId, key.vacancyId, STAGE, chatId)
              if (latest === null || !ACTIVE.includes(latest.job.status)) {
                const account = yield* tx.execute(
                  sql`select session_profile from hh_account where id = ${key.hhAccountId} and user_id = ${currentUser.userId} limit 1`
                )
                yield* chatReadJob(tx, {
                  userId: currentUser.userId,
                  hhAccountId: key.hhAccountId,
                  vacancyId: key.vacancyId,
                  chatId,
                  sessionProfile: (account.rows[0]?.session_profile as string | null | undefined) ?? null,
                  sequence: (yield* QueueRepository.countForVacancy(tx, key.hhAccountId, key.vacancyId, STAGE, chatId)) + 1
                })
              }
              return { _tag: "ok", view: yield* viewIn(tx, key, chatId) } as const
            })
          )
          .pipe(
            Effect.mapError(toStorageError("chat.refresh")),
            Effect.flatMap((result) =>
              result._tag === "ok"
                ? Effect.succeed(result.view)
                : Effect.fail<ApiError>(
                    new Conflict({
                      entity: "chat",
                      message:
                        result._tag === "nochat"
                          ? "У этого отклика нет известного чата. Сначала синхронизируйте отклики (`otbor hh sync`)."
                          : "Браузерный harness этого аккаунта не запущен. Запустите `otbor harness run` (или `otbor up --harness`) и повторите."
                    })
                  )
            )
          )

      const syncAll: ChatSyncShape["syncAll"] = (userId, options) =>
        database
          .asUser(userId, (tx) => enqueueChatReads(tx, userId, options))
          .pipe(Effect.mapError(toStorageError("chat.syncAll")))

      return ChatSync.of({ get, refresh, syncAll })
    })
  )
}
