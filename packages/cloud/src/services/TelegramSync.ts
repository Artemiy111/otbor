import type { ApiError, SyncResult } from "@otbor/contract"
import { InvalidInput, NotFound, StorageError } from "@otbor/contract"
import { extractContactsFromText, extractVacancyIds } from "@otbor/domain"
import {
  maskPhone,
  messageRead,
  writeSession,
  type TelegramDialog,
  type TelegramMessage
} from "@otbor/telegram"
import { Cause, Context, Deferred, Effect, Layer, Option, Ref } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ContactRepository from "../repositories/ContactRepository.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import * as TelegramRepository from "../repositories/TelegramRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { TelegramGatewayProvider } from "./TelegramGatewayProvider.ts"
import { toStorageError } from "./support.ts"

export interface TelegramSyncOptions {
  /** Dialogs per pass; private dialogs only. */
  readonly dialogs?: number
  readonly messages?: number
  readonly now?: Date
}

export type TelegramLoginState = "idle" | "pending" | "authorized" | "error"

export interface TelegramLoginResult {
  readonly qrUrl: string
  readonly expiresAt: string
}

export interface TelegramLoginStatusResult {
  readonly status: TelegramLoginState
  readonly error?: string | null
}

export interface TelegramSyncShape {
  readonly sync: (
    userId: string,
    accountId: string,
    options?: TelegramSyncOptions
  ) => Effect.Effect<SyncResult, ApiError>
  readonly loginQr: (
    userId: string,
    accountId: string
  ) => Effect.Effect<TelegramLoginResult, ApiError>
  readonly loginStatus: (
    userId: string,
    accountId: string
  ) => Effect.Effect<TelegramLoginStatusResult, ApiError>
}

interface Counters {
  processed: number
  inserted: number
  updated: number
  skipped: number
  contacts: number
  linked: number
  errors: string[]
}

interface LoginState {
  readonly status: TelegramLoginState
  readonly error: string | null
}

const emptyCounters = (): Counters => ({
  processed: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  contacts: 0,
  linked: 0,
  errors: []
})

const toResult = (counters: Counters): SyncResult => ({
  processed: counters.processed,
  inserted: counters.inserted,
  updated: counters.updated,
  skipped: counters.skipped,
  contacts: counters.contacts,
  linked: counters.linked,
  errors: counters.errors
})

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const parseDate = (value: string | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Telegram's own service account; it is not an HR dialog. */
const SERVICE_CHAT_ID = "777000"

const isServiceDialog = (dialog: TelegramDialog): boolean =>
  dialog.id === SERVICE_CHAT_ID ||
  (dialog.username !== null && /bot$/iu.test(dialog.username))

const uniqueContacts = (
  contacts: ReadonlyArray<{
    readonly kind: "email" | "telegram" | "phone" | "hh_chat" | "other"
    readonly value: string
    readonly raw?: string | null
    readonly url?: string | null
    readonly evidence?: string | null
    readonly confidence?: number | null
    readonly personName?: string | null
    readonly personRole?: string | null
    readonly isBot?: boolean | null
  }>
) => {
  const byKey = new Map<string, (typeof contacts)[number]>()
  for (const contact of contacts) {
    if (!byKey.has(`${contact.kind}:${contact.value}`)) {
      byKey.set(`${contact.kind}:${contact.value}`, contact)
    }
  }
  return [...byKey.values()]
}

const toMessageInputs = (
  messages: ReadonlyArray<TelegramMessage>,
  dialog: TelegramDialog,
  now: Date
) =>
  messages.map((message) => {
    const sentAt = parseDate(message.sentAt) ?? now
    return {
      externalId: message.id,
      direction: message.direction,
      sentAt,
      kind: message.kind,
      text: message.text,
      readAt: messageRead(message, dialog) ? sentAt : null
    }
  })

/**
 * Telegram history is pulled for private dialogs only. Bots and the Telegram
 * service account are skipped: they are not people and the product is a job
 * search, not a feed reader.
 */
export class TelegramSync extends Context.Service<TelegramSync, TelegramSyncShape>()(
  "otbor/cloud/TelegramSync"
) {
  static readonly layer = Layer.effect(
    TelegramSync,
    Effect.gen(function*() {
      const database = yield* Database
      const provider = yield* TelegramGatewayProvider
      const states = yield* Ref.make<Map<string, LoginState>>(new Map())

      const stateKey = (userId: string, accountId: string): string =>
        `${userId}:${accountId}`

      const setState = (key: string, state: LoginState) =>
        Ref.update(states, (current) => {
          const next = new Map(current)
          next.set(key, state)
          return next
        })

      const loadAccount = (userId: string, accountId: string) =>
        database
          .asUser(userId, (tx) => TelegramRepository.find(tx, userId, accountId))
          .pipe(Effect.mapError(toStorageError("telegram.account")))

      const setStatus = (
        userId: string,
        accountId: string,
        input: Parameters<typeof TelegramRepository.setStatus>[2]
      ) =>
        database
          .asUser(userId, (tx) => TelegramRepository.setStatus(tx, accountId, input))
          .pipe(Effect.catchCause(() => Effect.void))

      const sync: TelegramSyncShape["sync"] = (userId, accountId, options = {}) =>
        Effect.gen(function*() {
          const account = yield* loadAccount(userId, accountId)
          if (account === null) {
            return yield* new NotFound({ entity: "TelegramAccount", id: accountId })
          }

          const gateway = yield* provider.open(account)
          const counters = emptyCounters()
          const dialogLimit = Math.min(Math.max(options.dialogs ?? 25, 1), 100)
          const messageLimit = Math.min(Math.max(options.messages ?? 50, 1), 200)
          const now = options.now ?? new Date()

          const recordError = (label: string, error: unknown): void => {
            if (counters.errors.length >= 5) return
            counters.errors.push(`${label}: ${messageOf(error)}`)
          }

          const run = Effect.gen(function*() {
            yield* Effect.tryPromise({
              try: () => gateway.connect(),
              catch: (cause) => new Error(`connect: ${messageOf(cause)}`)
            })

            const me = yield* Effect.tryPromise({
              try: () => gateway.me(),
              catch: (cause) => new Error(`me: ${messageOf(cause)}`)
            })
            yield* database
              .asUser(userId, (tx) =>
                TelegramRepository.setProfile(tx, accountId, {
                  tgUserId: me.id,
                  username: me.username,
                  phoneMasked: maskPhone(me.phone)
                })
              )
              .pipe(Effect.mapError(toStorageError("telegram.profile")))

            const dialogs = yield* Effect.tryPromise({
              try: () => gateway.listDialogs(dialogLimit),
              catch: (cause) => new Error(`listDialogs: ${messageOf(cause)}`)
            })

            for (const dialog of dialogs) {
              if (dialog.kind !== "private" || isServiceDialog(dialog)) continue
              counters.processed += 1

              const messages = yield* Effect.tryPromise({
                try: () => gateway.listMessages(dialog.id, messageLimit),
                catch: (cause) => new Error(`listMessages ${dialog.id}: ${messageOf(cause)}`)
              }).pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    recordError(dialog.title ?? dialog.id, error)
                    return Effect.succeed([] as ReadonlyArray<TelegramMessage>)
                  },
                  onSuccess: (value) => Effect.succeed(value)
                })
              )

              yield* database
                .asUser(userId, (tx) =>
                  storeDialog(tx, userId, accountId, dialog, messages, now)
                )
                .pipe(
                  Effect.mapError(toStorageError("telegram.store")),
                  Effect.matchEffect({
                    onFailure: (error) => {
                      recordError(dialog.title ?? dialog.id, error)
                      return Effect.void
                    },
                    onSuccess: (value) =>
                      Effect.sync(() => {
                        counters.inserted += value.inserted
                        counters.skipped += value.updated
                        counters.updated += 1
                        counters.contacts += value.contacts
                        counters.linked += value.linked
                      })
                  })
                )
            }
          })

          yield* run.pipe(
            Effect.ensuring(
              Effect.tryPromise({ try: () => gateway.disconnect(), catch: () => undefined }).pipe(
                Effect.ignore
              )
            ),
            Effect.tap(() =>
              setStatus(userId, accountId, {
                status: "ok",
                lastError: null,
                lastSyncAt: now
              })
            ),
            Effect.catchCause((cause): Effect.Effect<never, ApiError> =>
              Effect.gen(function*() {
                const error = Cause.squash(cause)
                yield* Effect.logWarning(`telegram sync failed for ${account.label}`, error)
                yield* setStatus(userId, accountId, {
                  status: "error",
                  lastError: messageOf(error)
                })
                return yield* new StorageError({
                  operation: "telegram.sync",
                  message: messageOf(error)
                })
              })
            )
          )

          return toResult(counters)
        })

      const loginQr: TelegramSyncShape["loginQr"] = (userId, accountId) =>
        Effect.gen(function*() {
          const account = yield* loadAccount(userId, accountId)
          if (account === null) {
            return yield* new NotFound({ entity: "TelegramAccount", id: accountId })
          }

          const key = stateKey(userId, accountId)
          const current = yield* Ref.get(states)
          if (current.get(key)?.status === "pending") {
            return yield* new InvalidInput({
              message: "a Telegram QR login is already pending for this account"
            })
          }

          yield* setState(key, { status: "pending", error: null })
          const qr = Deferred.makeUnsafe<TelegramLoginResult>()
          const loginFailure = { message: "" }

          const login = Effect.gen(function*() {
            const gateway = yield* provider.open(account, { fresh: true })

            const body = Effect.gen(function*() {
              yield* Effect.tryPromise({
                try: () => gateway.connect(),
                catch: (cause) => new Error(`connect: ${messageOf(cause)}`)
              })

              const user = yield* Effect.tryPromise({
                try: () =>
                  gateway.loginWithQr({
                    onQr: (url, expiresAt) => {
                      Deferred.doneUnsafe(
                        qr,
                        Effect.succeed({
                          qrUrl: url,
                          expiresAt: expiresAt.toISOString()
                        })
                      )
                    },
                    onError: (error) => {
                      loginFailure.message = messageOf(error)
                    }
                  }),
                catch: (cause) => new Error(messageOf(cause))
              })

              const session = gateway.sessionString()
              yield* Effect.tryPromise({
                try: () => writeSession(account.id, session),
                catch: (cause) =>
                  new Error(`could not store the Telegram session: ${messageOf(cause)}`)
              })

              yield* database
                .asUser(userId, (tx) =>
                  TelegramRepository.setProfile(tx, account.id, {
                    tgUserId: user.id,
                    username: user.username,
                    phoneMasked: maskPhone(user.phone)
                  })
                )
                .pipe(Effect.mapError(toStorageError("telegram.profile")))
              yield* setStatus(userId, account.id, {
                status: "ok",
                lastError: null,
                lastSyncAt: new Date()
              })
              yield* setState(key, { status: "authorized", error: null })
            })

            yield* body.pipe(
              Effect.ensuring(
                Effect.tryPromise({
                  try: () => gateway.disconnect(),
                  catch: () => undefined
                }).pipe(Effect.ignore)
              )
            )
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function*() {
                const error = Cause.squash(cause)
                const message = loginFailure.message || messageOf(error)
                yield* setState(key, { status: "error", error: message })
                yield* setStatus(userId, account.id, { status: "error", lastError: message })
                yield* Effect.logWarning("telegram QR login failed", error)
              })
            )
          )

          yield* login.pipe(Effect.forkDetach)

          const ready = yield* Deferred.await(qr).pipe(Effect.timeoutOption("15 seconds"))
          if (Option.isNone(ready)) {
            return yield* new InvalidInput({
              message: "Telegram did not return a QR code; check the network and try again"
            })
          }
          return ready.value
        })

      const loginStatus: TelegramSyncShape["loginStatus"] = (userId, accountId) =>
        Effect.gen(function*() {
          const account = yield* loadAccount(userId, accountId)
          if (account === null) {
            return yield* new NotFound({ entity: "TelegramAccount", id: accountId })
          }
          const current = yield* Ref.get(states)
          const state = current.get(stateKey(userId, accountId))
          return {
            status: state?.status ?? "idle",
            error: state?.error ?? null
          }
        })

      return TelegramSync.of({ sync, loginQr, loginStatus })
    })
  )
}

const storeDialog = (
  tx: Executor,
  userId: string,
  accountId: string,
  dialog: TelegramDialog,
  messages: ReadonlyArray<TelegramMessage>,
  now: Date
) =>
  Effect.gen(function*() {
    const sentAt = parseDate(dialog.lastMessageAt) ?? now
    const url =
      dialog.username === null ? null : `https://t.me/${dialog.username.toLowerCase()}`

    const conversationId = yield* ConversationRepository.upsert(tx, {
      userId,
      channel: "telegram",
      accountId,
      externalId: dialog.id,
      title: dialog.title,
      url,
      personName: dialog.title,
      lastMessageAt: sentAt,
      unreadCount: dialog.unreadCount,
      archived: dialog.archived,
      raw: { kind: dialog.kind }
    })

    const inputs = toMessageInputs(messages, dialog, now)
    const saved = yield* ConversationRepository.appendMessages(
      tx,
      userId,
      conversationId,
      inputs
    )

    const text = [
      ...messages.map((message) => message.text ?? ""),
      dialog.lastMessage ?? ""
    ]
      .filter(Boolean)
      .join("\n")

    const extraction = extractContactsFromText(text, {
      senderName: dialog.title,
      channel: "telegram"
    })
    const vacancyIds = extractVacancyIds(text)

    const linkedVacancies: Array<string> = []
    for (const externalId of vacancyIds) {
      const vacancy = yield* VacancyRepository.findByExternal(tx, "hh", externalId)
      if (vacancy !== null) linkedVacancies.push(vacancy.id)
    }

    let linked = 0
    for (const [index, vacancyId] of linkedVacancies.entries()) {
      const created = yield* ConversationRepository.linkVacancy(tx, {
        userId,
        conversationId,
        vacancyId,
        kind: index === 0 ? "primary" : "mentioned",
        confidence: 1,
        source: "telegram",
        evidence: dialog.lastMessage
      })
      if (created) linked += 1
    }

    const candidates = [
      ...(dialog.username === null
        ? []
        : [
            {
              kind: "telegram" as const,
              value: `@${dialog.username.toLowerCase()}`,
              raw: `@${dialog.username}`,
              url,
              evidence: "Telegram profile",
              confidence: 1,
              personName: dialog.title,
              personRole: null,
              isBot: false
            }
          ]),
      ...extraction.contacts.map((contact) => ({
        kind: contact.kind,
        value: contact.value,
        raw: contact.raw,
        url: contact.url,
        evidence: contact.evidence,
        confidence: contact.confidence,
        personName: contact.personName,
        personRole: contact.personRole,
        isBot: contact.isBot
      }))
    ]

    const contacts = uniqueContacts(candidates)
    if (contacts.length > 0) {
      yield* ContactRepository.upsertMany(tx, {
        userId,
        contacts,
        source: "telegram",
        vacancyId: linkedVacancies[0] ?? null,
        evidence: dialog.lastMessage
      })
    }

    return {
      inserted: saved.inserted,
      updated: saved.updated,
      contacts: contacts.length,
      linked
    }
  })
