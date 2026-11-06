import { asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { randomUUID } from "node:crypto"
import {
  contact,
  conversation,
  conversationMessage,
  conversationVacancy,
  mailAccount,
  mailFolder,
  mailMessage,
  telegramAccount
} from "../../../src/db/tables.ts"
import { ContactService } from "../../../src/services/ContactService.ts"
import { ConversationService } from "../../../src/services/ConversationService.ts"
import { CrawlRunner, type CrawlRunnerResult } from "../../../src/services/CrawlRunner.ts"
import { type MailAccountUpsertInput, MailService } from "../../../src/services/MailService.ts"
import {
  type TelegramAccountUpsertInput,
  TelegramService
} from "../../../src/services/TelegramService.ts"
import { type LayerOptions, runAs, runAsFailure, runAsWithOptions } from "./layers.ts"
import { ownerTx } from "./seeds.ts"

export const contactsList = (
  userId: string,
  filter: {
    readonly query?: string
    readonly kind?: "email" | "telegram" | "phone" | "hh_chat" | "other"
    readonly source?: "hh_vacancy" | "mail" | "telegram" | "hh_chat" | "manual"
    readonly limit?: number
    readonly offset?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const contacts = yield* ContactService
      return yield* contacts.list(filter)
    })
  )

export const contactRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const contacts = yield* ContactService
      return yield* contacts.remove(id)
    })
  )

export const conversationsList = (
  userId: string,
  filter: {
    readonly channel?: "mail" | "telegram" | "hh_chat"
    readonly query?: string
    readonly limit?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const conversations = yield* ConversationService
      return yield* conversations.list(filter)
    })
  )

export const conversationGet = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const conversations = yield* ConversationService
      return yield* conversations.get(id)
    })
  )

export const conversationGetFailure = (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const conversations = yield* ConversationService
      return yield* conversations.get(id)
    })
  )

export const mailAccountsList = (userId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.list()
    })
  )

export const mailAccountUpsert = (userId: string, input: MailAccountUpsertInput) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.upsert(input)
    })
  )

export const mailAccountUpsertFailure = (userId: string, input: MailAccountUpsertInput) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.upsert(input)
    })
  )

export const mailAccountRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.remove(id)
    })
  )

export const mailAccountTest = (userId: string, id: string, layer: LayerOptions = {}) =>
  runAsWithOptions(
    userId,
    layer,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.test(id)
    })
  )

export const mailSyncNow = (userId: string, id: string, layer: LayerOptions = {}) =>
  runAsWithOptions(
    userId,
    layer,
    Effect.gen(function*() {
      const mail = yield* MailService
      return yield* mail.syncNow(id)
    })
  )

export const telegramAccountsList = (userId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.list()
    })
  )

export const telegramAccountUpsert = (
  userId: string,
  input: TelegramAccountUpsertInput
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.upsert(input)
    })
  )

export const telegramAccountUpsertFailure = (
  userId: string,
  input: TelegramAccountUpsertInput
) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.upsert(input)
    })
  )

export const telegramAccountRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.remove(id)
    })
  )

export const telegramSyncNow = (userId: string, id: string, layer: LayerOptions = {}) =>
  runAsWithOptions(
    userId,
    layer,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.syncNow(id)
    })
  )

export const telegramLoginQr = (userId: string, id: string, layer: LayerOptions = {}) =>
  runAsWithOptions(
    userId,
    layer,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.loginQr(id)
    })
  )

export const telegramLoginStatus = (userId: string, id: string, layer: LayerOptions = {}) =>
  runAsWithOptions(
    userId,
    layer,
    Effect.gen(function*() {
      const telegram = yield* TelegramService
      return yield* telegram.loginStatus(id)
    })
  )

export const contactRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx.select().from(contact).where(eq(contact.userId, userId))
    )
  )

export const conversationRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(conversation)
        .where(eq(conversation.userId, userId))
        .orderBy(asc(conversation.createdAt))
    )
  )

export const conversationMessagesFor = async (conversationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conversationId))
        .orderBy(asc(conversationMessage.sentAt))
    )
  )

export const conversationVacanciesFor = async (conversationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(conversationVacancy)
        .where(eq(conversationVacancy.conversationId, conversationId))
    )
  )

export const mailAccountRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx.select().from(mailAccount).where(eq(mailAccount.userId, userId))
    )
  )

export const mailFolderRowsFor = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(mailFolder)
        .where(eq(mailFolder.accountId, accountId))
        .orderBy(asc(mailFolder.path))
    )
  )

/** Rewinds the IMAP cursor so a second sync re-reads and must dedupe. */
export const resetMailFolderCursor = async (accountId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .update(mailFolder)
        .set({ lastUid: 0, uidValidity: null })
        .where(eq(mailFolder.accountId, accountId))
    )
  )
}

export const mailMessageRowsFor = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(mailMessage)
        .where(eq(mailMessage.accountId, accountId))
        .orderBy(asc(mailMessage.uid))
    )
  )

export const telegramAccountRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(telegramAccount)
        .where(eq(telegramAccount.userId, userId))
    )
  )

/** A fake runner that records every target and returns a clean result. */
export const recordingRunner = (targets: Array<string>) => {
  const layer = Layer.succeed(CrawlRunner, CrawlRunner.of({
    run: (input) =>
      Effect.sync(() => {
        targets.push(input.url)
        return {
          runId: randomUUID(),
          status: "done" as const,
          reason: "last_page",
          error: null,
          pagesDone: 1,
          found: 3,
          inserted: 3,
          updated: 0,
          skipped: 0,
          errors: 0
        } satisfies CrawlRunnerResult
      })
  }))
  return layer
}
