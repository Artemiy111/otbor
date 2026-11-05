import type { ApiError, ContactKind, SyncResult } from "@otbor/contract"
import { NotFound, StorageError } from "@otbor/contract"
import { extractContactsFromText, extractVacancyIds, mailThreadKey } from "@otbor/domain"
import {
  normalizeMessageId,
  type MailFolderRole,
  type MailMessage
} from "@otbor/mail"
import { Context, Cause, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ContactRepository from "../repositories/ContactRepository.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import * as MailRepository from "../repositories/MailRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { MailGatewayProvider } from "./MailGatewayProvider.ts"
import { toStorageError } from "./support.ts"

export interface MailSyncOptions {
  /** Messages per IMAP page; capped by the gateway. */
  readonly limit?: number
  readonly maxPages?: number
  /** Override the account's backfill window for this run; omitted uses the account setting. */
  readonly days?: number
  readonly now?: Date
}

export interface MailAccountTestResult {
  readonly ok: boolean
  readonly address: string
  readonly folders: number
  readonly messages: number | null
}

export interface MailSyncShape {
  /** Synchronous on purpose: a bounded pass an operator can wait for. */
  readonly sync: (
    userId: string,
    accountId: string,
    options?: MailSyncOptions
  ) => Effect.Effect<SyncResult, ApiError>
  readonly test: (
    userId: string,
    accountId: string
  ) => Effect.Effect<MailAccountTestResult, ApiError>
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

const isAuthError = (error: unknown): boolean =>
  error instanceof Error && /auth|credential|password|login/i.test(error.message)

const parseDate = (value: string | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const uniqueContacts = (
  contacts: ReadonlyArray<{
    readonly kind: ContactKind
    readonly value: string
    readonly raw?: string | null
    readonly url?: string | null
    readonly evidence?: string | null
    readonly confidence?: number | null
    readonly personName?: string | null
    readonly personRole?: string | null
    readonly isBot?: boolean | null
  }>
): Array<{
  kind: ContactKind
  value: string
  raw?: string | null
  url?: string | null
  evidence?: string | null
  confidence?: number | null
  personName?: string | null
  personRole?: string | null
  isBot?: boolean | null
}> => {
  const byKey = new Map<string, (typeof contacts)[number]>()
  for (const contact of contacts) {
    if (!byKey.has(`${contact.kind}:${contact.value}`)) {
      byKey.set(`${contact.kind}:${contact.value}`, contact)
    }
  }
  return [...byKey.values()]
}

const folderRole = (role: string): MailFolderRole =>
  role === "sent" || role === "inbox" || role === "archive" || role === "spam" || role === "trash"
    ? (role as MailFolderRole)
    : "other"

/**
 * Mail is pulled, never pushed. The pass is idempotent at two levels: the IMAP
 * UID cursor stops re-reading a folder, and the unique RFC Message-ID stops a
 * message that appears in both INBOX and Sent from being stored twice.
 */
export class MailSync extends Context.Service<MailSync, MailSyncShape>()(
  "otbor/cloud/MailSync"
) {
  static readonly layer = Layer.effect(
    MailSync,
    Effect.gen(function*() {
      const database = yield* Database
      const provider = yield* MailGatewayProvider

      const loadAccount = (userId: string, accountId: string) =>
        database
          .asUser(userId, (tx) => MailRepository.find(tx, userId, accountId))
          .pipe(Effect.mapError(toStorageError("mail.account")))

      const setStatus = (
        accountId: string,
        userId: string,
        input: Parameters<typeof MailRepository.setStatus>[2]
      ) =>
        database
          .asUser(userId, (tx) => MailRepository.setStatus(tx, accountId, input))
          .pipe(Effect.catchCause(() => Effect.void))

      const test: MailSyncShape["test"] = (userId, accountId) =>
        Effect.gen(function*() {
          const account = yield* loadAccount(userId, accountId)
          if (account === null) {
            return yield* new NotFound({ entity: "MailAccount", id: accountId })
          }

          const gateway = yield* provider.open(account)
          const status = yield* Effect.tryPromise({
            try: () => gateway.verify(),
            catch: (cause) =>
              new StorageError({
                operation: "mail.test",
                message: messageOf(cause)
              })
          }).pipe(
            Effect.ensuring(
              Effect.tryPromise(() => gateway.close()).pipe(Effect.ignore)
            )
          )

          return {
            ok: true,
            address: status.address,
            folders: status.folders,
            messages: status.messages
          }
        })

      const sync: MailSyncShape["sync"] = (userId, accountId, options = {}) =>
        Effect.gen(function*() {
          const account = yield* loadAccount(userId, accountId)
          if (account === null) {
            return yield* new NotFound({ entity: "MailAccount", id: accountId })
          }

          const gateway = yield* provider.open(account)
          const counters = emptyCounters()
          const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
          const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 100)

          const recordError = (label: string, error: unknown): void => {
            if (counters.errors.length >= 5) return
            counters.errors.push(`${label}: ${messageOf(error)}`)
          }

          const run = Effect.gen(function*() {
            const folders = yield* Effect.tryPromise({
              try: () => gateway.listFolders(),
              catch: (cause) => new Error(`listFolders: ${messageOf(cause)}`)
            })

            const targets = folders.filter(
              (folder) =>
                folder.role === "inbox" || (account.include_sent && folder.role === "sent")
            )
            if (targets.length === 0) {
              targets.push({
                path: "INBOX",
                name: "Inbox",
                role: "inbox",
                uidValidity: null
              })
            }

            for (const folder of targets) {
              const stored = yield* database
                .asUser(userId, (tx) =>
                  MailRepository.findFolder(tx, accountId, folder.path)
                )
                .pipe(Effect.mapError(toStorageError("mail.folder")))

              let afterUid = Number(stored?.last_uid ?? 0)
              const sinceDays = options.days ?? account.backfill_days

              for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
                let page = yield* Effect.tryPromise({
                  try: () =>
                    gateway.fetchPage(folder.path, { sinceDays, afterUid, limit }),
                  catch: (cause) => new Error(`fetchPage ${folder.path}: ${messageOf(cause)}`)
                })

                if (
                  stored?.uid_validity !== null &&
                  stored?.uid_validity !== undefined &&
                  page.uidValidity !== null &&
                  stored.uid_validity !== page.uidValidity
                ) {
                  // The mailbox was rebuilt: re-read from UID 0 and dedupe by RFC id.
                  afterUid = 0
                  page = yield* Effect.tryPromise({
                    try: () =>
                      gateway.fetchPage(folder.path, { sinceDays, afterUid: 0, limit }),
                    catch: (cause) =>
                      new Error(`fetchPage ${folder.path}: ${messageOf(cause)}`)
                  })
                }

                if (page.messages.length === 0) break

                for (const message of page.messages) {
                  counters.processed += 1
                  yield* database
                    .asUser(userId, (tx) =>
                      storeMessage(tx, userId, accountId, message, folder.role)
                    )
                    .pipe(
                      Effect.mapError(toStorageError("mail.store")),
                      Effect.matchEffect({
                        onFailure: (error) => {
                          recordError(message.rfcMessageId, error)
                          return Effect.void
                        },
                        onSuccess: (value) => Effect.sync(() => {
                          if (value.inserted) counters.inserted += 1
                          else counters.skipped += 1
                          counters.updated += value.conversationTouched
                          counters.contacts += value.contacts
                          counters.linked += value.linked
                        })
                      })
                    )
                }

                afterUid = page.lastUid
                yield* database
                  .asUser(userId, (tx) =>
                    MailRepository.upsertFolder(tx, {
                      userId,
                      accountId,
                      path: folder.path,
                      role: folderRole(folder.role),
                      uidValidity: page.uidValidity ?? stored?.uid_validity ?? null,
                      lastUid: afterUid
                    })
                  )
                  .pipe(Effect.mapError(toStorageError("mail.folder")))

                if (page.messages.length < limit) break
              }
            }
          })

          yield* run.pipe(
            Effect.ensuring(
              Effect.tryPromise({ try: () => gateway.close(), catch: () => undefined }).pipe(
                Effect.ignore
              )
            ),
            Effect.tap(() =>
              setStatus(accountId, userId, {
                status: "ok",
                lastError: null,
                lastSyncAt: options.now ?? new Date()
              })
            ),
            Effect.catchCause((cause): Effect.Effect<never, ApiError> =>
              Effect.gen(function*() {
                const error = Cause.squash(cause)
                yield* Effect.logWarning(`mail sync failed for ${account.address}`, error)
                yield* setStatus(accountId, userId, {
                  status: isAuthError(error) ? "auth_failed" : "error",
                  lastError: messageOf(error)
                })
                return yield* new StorageError({
                  operation: "mail.sync",
                  message: messageOf(error)
                })
              })
            )
          )

          return toResult(counters)
        })

      return MailSync.of({ sync, test })
    })
  )
}

const storeMessage = (
  tx: Executor,
  userId: string,
  accountId: string,
  message: MailMessage,
  role: string
) =>
  Effect.gen(function*() {
    const rfcMessageId = normalizeMessageId(message.rfcMessageId) ?? message.rfcMessageId
    const exists = yield* MailRepository.messageExists(tx, accountId, rfcMessageId)
    if (exists) {
      return { inserted: false, conversationTouched: 0, contacts: 0, linked: 0 }
    }

    const references = message.references
      .map((reference) => normalizeMessageId(reference))
      .filter((reference): reference is string => reference !== null)
    const inReplyTo = normalizeMessageId(message.inReplyTo)
    const subject = message.subject?.trim() ?? null
    const sentAt = parseDate(message.sentAt) ?? parseDate(message.receivedAt) ?? new Date()

    // A reply belongs to the conversation of the message it references. The
    // fallback key is only used when no ancestor is stored yet.
    const parentConversation = yield* ConversationRepository.conversationForMessage(tx, accountId, [
      ...references,
      ...(inReplyTo === null ? [] : [inReplyTo])
    ])

    const threadKey = mailThreadKey({
      threadId: message.threadId ?? null,
      rfcMessageId,
      inReplyTo,
      references,
      subject
    })
    const subjectKey = mailThreadKey({ subject })
    // Gmail thread ids are authoritative. Otherwise a stored ancestor is the
    // best signal; when there is none, a single subject key keeps a reply that
    // arrived before the original in the same thread instead of splitting it.
    const externalKey =
      message.threadId !== undefined && message.threadId !== null && message.threadId !== ""
        ? threadKey
        : subjectKey !== "subj:"
          ? subjectKey
          : threadKey

    let conversationTouched = 0
    const conversationId =
      parentConversation ??
      (yield* Effect.gen(function*() {
        const existing =
          (yield* ConversationRepository.findByExternal(tx, {
            userId,
            channel: "mail",
            accountId,
            externalId: threadKey
          })) ??
          (externalKey === threadKey
            ? null
            : yield* ConversationRepository.findByExternal(tx, {
                userId,
                channel: "mail",
                accountId,
                externalId: externalKey
              }))

        if (existing !== null) {
          conversationTouched = 1
          return existing
        }
        const created = yield* ConversationRepository.upsert(tx, {
          userId,
          channel: "mail",
          accountId,
          externalId: externalKey,
          title: subject,
          personName: message.from[0]?.name ?? null,
          lastMessageAt: sentAt,
          raw: { threadKey, subjectKey }
        })
        conversationTouched = 1
        return created
      }))

    const direction: "in" | "out" = role === "sent" ? "out" : "in"
    yield* ConversationRepository.appendMessages(tx, userId, conversationId, [
      {
        externalId: rfcMessageId,
        direction,
        sentAt,
        kind: "text",
        text: message.text === "" ? null : message.text,
        readAt: direction === "out" ? sentAt : null
      }
    ])

    const sender = message.from[0] ?? null
    const extraction = extractContactsFromText(
      [subject ?? "", message.text].filter(Boolean).join("\n"),
      { senderName: sender?.name ?? null, channel: "mail" }
    )
    const vacancyIds = extractVacancyIds(
      [subject ?? "", message.text].filter(Boolean).join("\n")
    )

    const linkedVacancies: Array<{ id: string; externalId: string }> = []
    for (const externalId of vacancyIds) {
      const vacancy = yield* VacancyRepository.findByExternal(tx, "hh", externalId)
      if (vacancy === null) continue
      linkedVacancies.push({ id: vacancy.id, externalId })
    }

    let linked = 0
    for (const [index, vacancy] of linkedVacancies.entries()) {
      const created = yield* ConversationRepository.linkVacancy(tx, {
        userId,
        conversationId,
        vacancyId: vacancy.id,
        kind: index === 0 ? "primary" : "mentioned",
        confidence: 1,
        source: "mail",
        evidence: message.snippet
      })
      if (created) linked += 1
    }

    const isNoReplyAddress = (address: string): boolean =>
      /no[-_]?reply|do[-_]?not[-_]?reply|noreply/i.test(address)

    const contactCandidates = [
      ...(sender === null || isNoReplyAddress(sender.address)
        ? []
        : [
            {
              kind: "email" as const,
              value: sender.address.trim().toLowerCase(),
              raw: sender.address,
              url: `mailto:${sender.address.trim().toLowerCase()}`,
              evidence: subject,
              confidence: 1,
              personName: sender.name,
              personRole: null,
              isBot: false
            }
          ]),
      ...extraction.contacts
        .filter((contact) => !(contact.kind === "email" && isNoReplyAddress(contact.value)))
        .map((contact) => ({
        kind: contact.kind === "other" ? ("other" as const) : contact.kind,
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

    const contacts = uniqueContacts(contactCandidates)
    if (contacts.length > 0) {
      yield* ContactRepository.upsertMany(tx, {
        userId,
        contacts,
        source: "mail",
        vacancyId: linkedVacancies[0]?.id ?? null,
        evidence: message.snippet
      })
    }

    yield* MailRepository.insertMessage(tx, {
      userId,
      accountId,
      conversationId,
      folder: message.folder,
      uid: message.uid,
      rfcMessageId,
      inReplyTo,
      subject,
      from: message.from.map((address) => ({
        name: address.name,
        address: address.address.trim().toLowerCase()
      })),
      to: message.to.map((address) => ({
        name: address.name,
        address: address.address.trim().toLowerCase()
      })),
      cc: message.cc.map((address) => ({
        name: address.name,
        address: address.address.trim().toLowerCase()
      })),
      receivedAt: parseDate(message.receivedAt),
      snippet: message.snippet,
      attachmentCount: message.attachmentCount,
      attachmentNames: message.attachmentNames,
      size: message.size
    })

    return {
      inserted: true,
      conversationTouched,
      contacts: contacts.length,
      linked
    }
  })
