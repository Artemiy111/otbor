/** Integration: sources. See README.md for how to run. */
import type { VacancyDraft } from "@otbor/contract"
import { FakeMailGateway, type MailMessage, accountSecretExists } from "@otbor/mail"
import {
  FakeTelegramGateway,
  type TelegramDialog,
  type TelegramMessage,
  readSession
} from "@otbor/telegram"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type HydrationRunResult, HydrationRunner } from "../../src/services/HydrationRunner.ts"
import { TelegramService } from "../../src/services/TelegramService.ts"
import {
  contactRemove,
  contactRowsFor,
  contactsList,
  conversationGet,
  conversationGetFailure,
  conversationRowsFor,
  conversationVacanciesFor,
  conversationsList,
  corpusIngest,
  createTestDatabase,
  dropTestDatabase,
  findScheduleRow,
  integrationEnabled,
  mailAccountRemove,
  mailAccountRowsFor,
  mailAccountTest,
  mailAccountUpsert,
  mailAccountUpsertFailure,
  mailAccountsList,
  mailFolderRowsFor,
  mailMessageRowsFor,
  mailSyncNow,
  migrateTestDatabase,
  recordingRunner,
  resetMailFolderCursor,
  runAsWithOptions,
  runDueSchedulesWithGateways,
  scheduleRemove,
  scheduleUpsert,
  scheduleUpsertFailure,
  seedTenant,
  seedVacancyWithExternal,
  serverUrl,
  setScheduleNextRun,
  telegramAccountRemove,
  telegramAccountRowsFor,
  telegramAccountUpsert,
  telegramAccountUpsertFailure,
  telegramAccountsList,
  telegramSyncNow,
  testDatabaseUrl
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    // Documented in test/integration/README.md and root `bun run test:integration`.
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    // `Database.layer` reads DATABASE_URL when the layer is built, so every
    // request in this suite points at the throwaway database.
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    await dropTestDatabase(base)
  }, 60_000)

  describe("sources", () => {
    const previousMailDir = process.env.OTBOR_MAIL_DIR
    const previousTelegramDir = process.env.OTBOR_TELEGRAM_DIR
    let mailDir = ""
    let telegramDir = ""

    beforeAll(async () => {
      mailDir = await mkdtemp(join(tmpdir(), "otbor-mail-"))
      telegramDir = await mkdtemp(join(tmpdir(), "otbor-telegram-"))
      process.env.OTBOR_MAIL_DIR = mailDir
      process.env.OTBOR_TELEGRAM_DIR = telegramDir
    })

    afterAll(async () => {
      if (previousMailDir === undefined) delete process.env.OTBOR_MAIL_DIR
      else process.env.OTBOR_MAIL_DIR = previousMailDir
      if (previousTelegramDir === undefined) delete process.env.OTBOR_TELEGRAM_DIR
      else process.env.OTBOR_TELEGRAM_DIR = previousTelegramDir
      await rm(mailDir, { recursive: true, force: true })
      await rm(telegramDir, { recursive: true, force: true })
    })

    const uniqueDigits = (): string =>
      `${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

    const mailMessage = (
      input: Pick<MailMessage, "folder" | "uid" | "rfcMessageId"> & Partial<MailMessage>
    ): MailMessage => ({
      inReplyTo: null,
      references: [],
      from: [],
      to: [],
      cc: [],
      subject: null,
      sentAt: null,
      receivedAt: new Date().toISOString(),
      text: "",
      snippet: "",
      listId: null,
      authResults: null,
      attachmentCount: 0,
      attachmentNames: [],
      size: 0,
      ...input
    })

    const telegramMessage = (
      id: string,
      direction: "in" | "out",
      text: string
    ): TelegramMessage => ({
      id,
      direction,
      sentAt: new Date().toISOString(),
      editedAt: null,
      kind: "text",
      text,
      replyToId: null
    })

    test("vacancy ingestion extracts contacts scoped to the owner", async () => {
      const a = await seedTenant("src-contacts-a")
      const b = await seedTenant("src-contacts-b")
      const externalId = `v-${randomUUID().slice(0, 8)}`

      const draft: VacancyDraft = {
        externalId,
        canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
        title: "Senior DevOps Engineer",
        descriptionText: [
          "Свяжитесь с HR Анной: anna@acme.dev",
          "Telegram: @acme_hr",
          "Телефон: +7 (999) 123-45-67"
        ].join("\n"),
        employer: { externalId: `e-${externalId}`, name: "Acme" }
      }

      const saved = await corpusIngest(a.userId, [draft])
      expect(saved.inserted).toBe(1)

      const list = await contactsList(a.userId, { source: "hh_vacancy" })
      expect(list.total).toBe(3)
      expect(list.items.map((contact) => `${contact.kind}:${contact.value}`).sort()).toEqual(
        ["email:anna@acme.dev", "phone:+79991234567", "telegram:@acme_hr"].sort()
      )
      for (const contact of list.items) {
        expect(contact.vacancyId).toBe(saved.items[0]!.id)
        expect(contact.source).toBe("hh_vacancy")
        expect(contact.evidence).toBeTruthy()
      }

      const email = list.items.find((contact) => contact.kind === "email")!
      expect(email.personName).toBeNull()

      expect(await contactsList(b.userId)).toEqual({ items: [], total: 0 })
      expect(await contactRemove(b.userId, email.id)).toMatchObject({ deleted: false })
      expect(await contactRowsFor(a.userId)).toHaveLength(3)
      expect(await contactRemove(a.userId, email.id)).toMatchObject({
        id: email.id,
        deleted: true
      })
      expect((await contactsList(a.userId, { kind: "phone" })).total).toBe(1)
      expect((await contactsList(a.userId, { query: "@acme" })).total).toBe(1)
    })

    test("mail account CRUD, fake sync and idempotency", async () => {
      const a = await seedTenant("src-mail-a")
      const b = await seedTenant("src-mail-b")

      const externalId = uniqueDigits()
      const vacancyId = await seedVacancyWithExternal(externalId, "Senior DevOps")

      const messages: MailMessage[] = [
        mailMessage({
          folder: "INBOX",
          uid: 1,
          rfcMessageId: "root@acme.dev",
          from: [{ name: "Anna HR", address: "Anna@Acme.dev" }],
          to: [{ name: "Me", address: "me@acme.dev" }],
          subject: "Senior DevOps vacancy",
          sentAt: new Date("2026-11-01T09:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T09:00:00.000Z").toISOString(),
          text: `Пишите: anna@acme.dev, Telegram @acme_hr, +7 999 123-45-67. Вакансия https://hh.ru/vacancy/${externalId}`,
          snippet: "Пишите: anna@acme.dev"
        }),
        mailMessage({
          folder: "Sent",
          uid: 2,
          rfcMessageId: "reply@acme.dev",
          inReplyTo: "root@acme.dev",
          references: ["root@acme.dev"],
          from: [{ name: "Me", address: "me@acme.dev" }],
          to: [{ name: "Anna HR", address: "anna@acme.dev" }],
          subject: "Re: Senior DevOps vacancy",
          sentAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
          text: "Спасибо, откликнулся.",
          snippet: "Спасибо"
        }),
        mailMessage({
          folder: "INBOX",
          uid: 3,
          rfcMessageId: "other@other.dev",
          from: [{ name: "Bob", address: "bob@other.dev" }],
          to: [{ name: "Me", address: "me@acme.dev" }],
          subject: "Another role",
          sentAt: new Date("2026-11-01T11:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T11:00:00.000Z").toISOString(),
          text: "Здравствуйте, есть другая вакансия.",
          snippet: "Здравствуйте"
        })
      ]

      const fake = new FakeMailGateway({ address: "me@acme.dev", messages })
      const account = await mailAccountUpsert(a.userId, {
        label: "work",
        address: "me@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "me@acme.dev",
        password: "app-password",
        includeSent: true,
        backfillDays: 90
      })

      expect(account.status).toBe("idle")
      expect(account.includeSent).toBe(true)
      expect(await accountSecretExists(account.id)).toBe(true)
      expect((await mailAccountsList(a.userId)).map((row) => row.id)).toEqual([account.id])
      expect(await mailAccountsList(b.userId)).toEqual([])

      const probe = await mailAccountTest(a.userId, account.id, { mailGateway: fake })
      expect(probe).toMatchObject({ ok: true, address: "me@acme.dev", folders: 2 })

      const first = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(first.processed).toBe(3)
      expect(first.inserted).toBe(3)
      expect(first.skipped).toBe(0)
      expect(first.linked).toBe(1)
      expect(first.contacts).toBeGreaterThan(0)
      expect(first.errors).toEqual([])

      expect(await mailMessageRowsFor(account.id)).toHaveLength(3)
      const folders = await mailFolderRowsFor(account.id)
      expect(folders.map((folder) => folder.path)).toEqual(["INBOX", "Sent"])
      expect(folders.find((folder) => folder.path === "INBOX")?.lastUid).toBe(3)
      expect(folders.find((folder) => folder.path === "Sent")?.lastUid).toBe(2)

      const conversations = await conversationsList(a.userId, { channel: "mail" })
      expect(conversations).toHaveLength(2)
      const threaded = conversations.find((row) => row.externalId === "subj:senior devops vacancy")!
      expect(threaded).toBeDefined()
      expect(threaded.vacancyId as string | null).toBe(vacancyId)
      expect(threaded.lastMessage).toBe("Спасибо, откликнулся.")

      const detail = await conversationGet(a.userId, threaded.id)
      expect(detail.messages.map((message) => message.direction)).toEqual(["in", "out"])
      expect(detail.messages.map((message) => message.externalId)).toEqual([
        "root@acme.dev",
        "reply@acme.dev"
      ])

      expect(await conversationVacanciesFor(threaded.id)).toEqual([
        expect.objectContaining({ vacancyId, kind: "primary", source: "mail" })
      ])

      expect(await conversationsList(b.userId)).toEqual([])
      expect((await conversationGetFailure(b.userId, threaded.id))._tag).toBe("NotFound")

      const synced = (await mailAccountRowsFor(a.userId)).find((row) => row.id === account.id)!
      expect(synced.status).toBe("ok")
      expect(synced.lastSyncAt).not.toBeNull()
      expect(synced.lastError).toBeNull()

      // A second pass finds no new UIDs.
      const second = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(second.processed).toBe(0)
      expect(second.inserted).toBe(0)

      // Rewinding the cursor re-reads everything and dedupes by RFC Message-ID.
      await resetMailFolderCursor(account.id)
      const third = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(third.processed).toBe(3)
      expect(third.inserted).toBe(0)
      expect(third.skipped).toBe(3)
      expect(await mailMessageRowsFor(account.id)).toHaveLength(3)
      expect(await conversationRowsFor(a.userId)).toHaveLength(2)

      const updated = await mailAccountUpsert(a.userId, {
        id: account.id,
        label: "work-2",
        address: "me@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "me@acme.dev"
      })
      expect(updated.id).toBe(account.id)
      expect(updated.label).toBe("work-2")

      const invalid = await mailAccountUpsertFailure(a.userId, {
        label: "bad",
        address: "not-an-email",
        host: "imap.acme.dev",
        port: 993,
        username: "me"
      })
      expect(invalid._tag).toBe("InvalidInput")

      expect(await mailAccountRemove(b.userId, account.id)).toMatchObject({ deleted: false })
      expect(await mailAccountRemove(a.userId, account.id)).toMatchObject({
        id: account.id,
        deleted: true
      })
      expect(await accountSecretExists(account.id)).toBe(false)
      expect(await mailAccountsList(a.userId)).toEqual([])
    })

    test("telegram account CRUD and fake sync", async () => {
      const a = await seedTenant("src-tg-a")
      const b = await seedTenant("src-tg-b")
      const externalId = uniqueDigits()
      const vacancyId = await seedVacancyWithExternal(externalId, "Platform Engineer")

      const dialogs: TelegramDialog[] = [
        {
          id: "100",
          title: "Anna HR",
          username: "acme_hr",
          kind: "private",
          lastMessageAt: new Date("2026-11-01T12:00:00.000Z").toISOString(),
          lastMessage: "Пишите в телеграм",
          unreadCount: 2,
          readInboxMaxId: 1,
          readOutboxMaxId: null,
          archived: false
        },
        {
          id: "-200",
          title: "Acme channel",
          username: null,
          kind: "channel",
          lastMessageAt: null,
          lastMessage: "news",
          unreadCount: 5,
          readInboxMaxId: null,
          readOutboxMaxId: null,
          archived: false
        },
        {
          id: "300",
          title: "Acme bot",
          username: "acme_bot",
          kind: "private",
          lastMessageAt: null,
          lastMessage: "beep",
          unreadCount: 0,
          readInboxMaxId: null,
          readOutboxMaxId: null,
          archived: false
        }
      ]

      const fake = new FakeTelegramGateway({
        me: {
          id: "42",
          username: "my_tg",
          firstName: "Me",
          lastName: null,
          phone: "+79990001122"
        },
        dialogs,
        messages: {
          "100": [
            telegramMessage(
              "1",
              "in",
              `Здравствуйте! anna@acme.dev, @acme_hr, вакансия https://hh.ru/vacancy/${externalId}`
            ),
            telegramMessage("2", "out", "Спасибо, посмотрю.")
          ]
        }
      })
      fake.authorized = true

      const account = await telegramAccountUpsert(a.userId, {
        label: "hr",
        apiId: 123456,
        apiHash: "0123456789abcdef0123456789abcdef",
        phone: "+7 999 123-45-67"
      })
      expect(account.status).toBe("idle")
      expect(account.phoneMasked).toBe("+79***4567")
      expect((await telegramAccountsList(a.userId)).map((row) => row.id)).toEqual([account.id])
      expect(await telegramAccountsList(b.userId)).toEqual([])

      const invalid = await telegramAccountUpsertFailure(a.userId, {
        label: "bad",
        apiId: 0,
        apiHash: "x"
      })
      expect(invalid._tag).toBe("InvalidInput")

      const sync = await telegramSyncNow(a.userId, account.id, { telegramGateway: fake })
      expect(sync.processed).toBe(1)
      expect(sync.inserted).toBe(2)
      expect(sync.skipped).toBe(0)
      expect(sync.linked).toBe(1)
      expect(sync.contacts).toBeGreaterThan(0)
      expect(sync.errors).toEqual([])

      const conversations = await conversationsList(a.userId, { channel: "telegram" })
      expect(conversations).toHaveLength(1)
      expect(conversations[0]).toMatchObject({
        externalId: "100",
        title: "Anna HR",
        unreadCount: 2,
        vacancyId
      })
      const detail = await conversationGet(a.userId, conversations[0]!.id)
      expect(detail.messages).toHaveLength(2)
      expect(detail.messages[0]).toMatchObject({
        externalId: "1",
        direction: "in",
        kind: "text"
      })
      expect(detail.messages[0]!.readAt).not.toBeNull()
      expect(detail.messages[1]!.readAt).toBeNull()

      const contacts = await contactsList(a.userId, { source: "telegram" })
      expect(contacts.items.map((contact) => `${contact.kind}:${contact.value}`)).toContain(
        "telegram:@acme_hr"
      )
      expect(await conversationsList(b.userId)).toEqual([])

      const second = await telegramSyncNow(a.userId, account.id, { telegramGateway: fake })
      // Синхронизация инкрементальна: новее сохранённых сообщений ничего нет.
      expect(second.inserted).toBe(0)
      expect(second.skipped).toBe(0)

      expect(await telegramAccountRemove(b.userId, account.id)).toMatchObject({ deleted: false })
      expect(await telegramAccountRemove(a.userId, account.id)).toMatchObject({
        id: account.id,
        deleted: true
      })
      expect(await telegramAccountsList(a.userId)).toEqual([])
    })

    test("telegram QR login stores the session and reports status", async () => {
      const tenant = await seedTenant("src-tg-qr")
      const fake = new FakeTelegramGateway({
        me: {
          id: "77",
          username: "qr_user",
          firstName: "Qr",
          lastName: null,
          phone: "+79990002233"
        },
        qrUrl: "tg://login?token=cXItZmFrZQ",
        qrExpiresAt: new Date("2026-11-02T13:00:00.000Z")
      })
      fake.authorized = false

      const account = await telegramAccountUpsert(tenant.userId, {
        label: "qr",
        apiId: 654321,
        apiHash: "abcdef0123456789abcdef0123456789"
      })

      const result = await runAsWithOptions(
        tenant.userId,
        { telegramGateway: fake },
        Effect.gen(function*() {
          const telegram = yield* TelegramService
          const qr = yield* telegram.loginQr(account.id)
          const status = yield* Effect.gen(function*() {
            for (;;) {
              const current = yield* telegram.loginStatus(account.id)
              if (current.status !== "pending" && current.status !== "idle") return current
              yield* Effect.sleep("20 millis")
            }
          }).pipe(Effect.timeoutOption("3 seconds"))
          return { qr, status }
        })
      )

      expect(result.qr.qrUrl).toBe("tg://login?token=cXItZmFrZQ")
      expect(result.qr.expiresAt).toBe("2026-11-02T13:00:00.000Z")
      expect(Option.isSome(result.status)).toBe(true)
      if (Option.isSome(result.status)) {
        expect(result.status.value.status).toBe("authorized")
      }
      expect(await readSession(account.id)).not.toBeNull()

      const row = (await telegramAccountRowsFor(tenant.userId))[0]!
      expect(row.status).toBe("ok")
      expect(row.tgUserId).toBe("77")
      expect(row.username).toBe("qr_user")
      expect(row.phoneMasked).toBe("+79***2233")
    })

    test("schedules dispatch source kinds and isolate failures", async () => {
      const tenant = await seedTenant("src-sched")
      const now = new Date("2026-11-02T14:00:00.000Z")

      const externalId = uniqueDigits()
      await seedVacancyWithExternal(externalId, "SRE")
      const fake = new FakeMailGateway({
        address: "sched@acme.dev",
        messages: [
          mailMessage({
            folder: "INBOX",
            uid: 1,
            rfcMessageId: "sched@acme.dev",
            from: [{ name: "HR", address: "hr@acme.dev" }],
            to: [{ name: "Me", address: "sched@acme.dev" }],
            subject: "SRE role",
            sentAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            receivedAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            text: `Вакансия https://hh.ru/vacancy/${externalId}`,
            snippet: "SRE role"
          })
        ]
      })
      const account = await mailAccountUpsert(tenant.userId, {
        label: "sched",
        address: "sched@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "sched@acme.dev",
        password: "secret"
      })
      const telegramFake = new FakeTelegramGateway({
        dialogs: [
          {
            id: "500",
            title: "Sched HR",
            username: "sched_hr",
            kind: "private",
            lastMessageAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            lastMessage: "hello",
            unreadCount: 1,
            readInboxMaxId: null,
            readOutboxMaxId: null,
            archived: false
          }
        ],
        messages: { "500": [telegramMessage("1", "in", "Здравствуйте из телеграма")] }
      })
      telegramFake.authorized = true
      const telegramAccount = await telegramAccountUpsert(tenant.userId, {
        label: "sched-tg",
        apiId: 222222,
        apiHash: "fedcba9876543210fedcba9876543210"
      })

      const chatSchedule = await scheduleUpsert(tenant.userId, {
        kind: "hh_chat_sync",
        targetId: "not-a-uuid",
        intervalMinutes: 60
      })
      expect(chatSchedule.kind).toBe("hh_chat_sync")

      const mailSchedule = await scheduleUpsert(tenant.userId, {
        kind: "mail_sync",
        targetId: account.id,
        intervalMinutes: 30,
        options: { limit: 50, maxPages: 2 }
      })
      expect(mailSchedule).toMatchObject({
        kind: "mail_sync",
        targetId: account.id,
        options: { limit: 50, maxPages: 2 }
      })

      const hydrationCalls: Array<{
        limit?: number
        delayMs?: number
        proxyMode?: string
        onProgress?: (progress: Record<string, unknown>) => unknown
      }> = []
      const hydrationLayer = Layer.succeed(HydrationRunner, HydrationRunner.of({
        run: (_userId: string, options: { limit?: number; delayMs?: number; proxyMode?: string } = {}) =>
          Effect.sync(() => {
            hydrationCalls.push(options)
            return {
              processed: 1,
              target: 1,
              hydrated: 1,
              failed: 0,
              inserted: 1,
              updated: 0,
              skipped: 0,
              errors: [],
              proxyMode: "auto",
              proxy: "напрямую",
              proxySource: null,
              stoppedBy: null,
              rotations: 0
            } satisfies HydrationRunResult
          }),
        hydrateOne: (_userId: string, _id: string) => Effect.succeed(true),
        fetchByReference: (_userId: string, _reference: string) =>
          Effect.die("fetchByReference is not used by schedules")
      }))
      const hydrationSchedule = await scheduleUpsert(tenant.userId, {
        kind: "vacancy_hydration",
        targetId: "global",
        intervalMinutes: 120,
        options: { limit: 5, delayMs: 0 }
      })

      const telegramSchedule = await scheduleUpsert(tenant.userId, {
        kind: "telegram_sync",
        targetId: telegramAccount.id,
        intervalMinutes: 30
      })

      const past = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
      await setScheduleNextRun(chatSchedule.id, past(5))
      await setScheduleNextRun(mailSchedule.id, past(4))
      await setScheduleNextRun(hydrationSchedule.id, past(3))
      await setScheduleNextRun(telegramSchedule.id, past(2))

      const outcomes = await runDueSchedulesWithGateways(
        tenant.userId,
        {
          runner: recordingRunner([]),
          hydrationRunner: hydrationLayer,
          mailGateway: fake,
          telegramGateway: telegramFake
        },
        { now, limit: 10 }
      )

      expect(outcomes).toHaveLength(4)

      const chat = outcomes.find((row) => row.scheduleId === chatSchedule.id)!
      // Цель-не-uuid роняет SQL внутри прохода: сбой одного расписания не мешает остальным.
      expect(chat.ok).toBe(false)
      expect(chat.error).toBeTruthy()

      const mail = outcomes.find((row) => row.scheduleId === mailSchedule.id)!
      expect(mail).toMatchObject({ ok: true, error: null, kind: "mail_sync" })

      const hydration = outcomes.find((row) => row.scheduleId === hydrationSchedule.id)!
      expect(hydration).toMatchObject({ ok: true, error: null })
      expect(hydrationCalls).toEqual([
        { limit: 5, delayMs: 0, proxyMode: "auto", onProgress: expect.any(Function) }
      ])

      const telegram = outcomes.find((row) => row.scheduleId === telegramSchedule.id)!
      expect(telegram).toMatchObject({ ok: true, error: null, kind: "telegram_sync" })

      expect((await findScheduleRow(chatSchedule.id))?.lastError).toBe(chat.error)
      expect((await findScheduleRow(mailSchedule.id))?.lastError).toBeNull()
      expect((await findScheduleRow(telegramSchedule.id))?.lastError).toBeNull()
      expect(await conversationsList(tenant.userId, { channel: "mail" })).toHaveLength(1)
      expect(await conversationsList(tenant.userId, { channel: "telegram" })).toHaveLength(1)

      const invalidTarget = await scheduleUpsertFailure(tenant.userId, {
        kind: "mail_sync",
        targetId: "https://hh.ru/search/vacancy?text=x",
        intervalMinutes: 30
      })
      expect(invalidTarget._tag).toBe("InvalidInput")

      for (const schedule of [
        chatSchedule,
        mailSchedule,
        hydrationSchedule,
        telegramSchedule
      ]) {
        await scheduleRemove(tenant.userId, schedule.id)
      }
      await mailAccountRemove(tenant.userId, account.id)
      await telegramAccountRemove(tenant.userId, telegramAccount.id)
    })
  })
}
