/** Integration: люди и привязка диалогов при синхронизации Telegram и чатов hh. */
import type { VacancyDraft } from "@otbor/contract"
import type { ParsedChat } from "@otbor/hh"
import { FakeTelegramGateway, type TelegramDialog, type TelegramMessage } from "@otbor/telegram"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { hhAccountContact } from "../../src/db/tables.ts"
import { enqueueChatReads, importChat } from "../../src/services/ChatSync.ts"
import {
  contactRowsOf,
  conversationRowOf,
  corpusIngest,
  createTestDatabase,
  dropTestDatabase,
  integrationEnabled,
  linkedVacanciesOf,
  migrateTestDatabase,
  ownerTx,
  personList,
  runAs,
  seedApplication,
  seedConversation,
  seedResume,
  seedTenant,
  seedVacancyWithExternal,
  serverUrl,
  telegramAccountUpsert,
  telegramSyncNow,
  testDatabaseUrl,
  vacancyRefsOf
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await dropTestDatabase(base)
  }, 60_000)

  const digits = (): string => `${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

  const message = (id: string, direction: "in" | "out", text: string): TelegramMessage => ({
    id,
    direction,
    sentAt: new Date(Date.UTC(2026, 10, 1, 12, Number(id))).toISOString(),
    editedAt: null,
    kind: "text",
    text,
    replyToId: null
  })

  const dialog = (id: string, username: string | null): TelegramDialog => ({
    id,
    title: "Анна Рекрутер",
    username,
    kind: "private",
    lastMessageAt: new Date(Date.UTC(2026, 10, 1, 13)).toISOString(),
    lastMessage: null,
    unreadCount: 0,
    readInboxMaxId: null,
    readOutboxMaxId: null,
    archived: false
  })

  const resumeLinksOf = (conversationId: string) =>
    runAs(
      "owner",
      ownerTx((tx) =>
        tx
          .execute(
            sql`select resume_id::text as resume_id, confidence, source from conversation_resume where conversation_id = ${conversationId}`
          )
          .pipe(
            Effect.map(
              (result) =>
                result.rows as unknown as ReadonlyArray<{
                  resume_id: string
                  confidence: number
                  source: string
                }>
            )
          )
      )
    )

  const messageIdsOf = (conversationId: string) =>
    runAs(
      "owner",
      ownerTx((tx) =>
        tx
          .execute(
            sql`select external_id from conversation_message where conversation_id = ${conversationId} order by external_id::bigint`
          )
          .pipe(Effect.map((result) => result.rows.map((row) => (row as { external_id: string }).external_id)))
      )
    )

  describe("people sync", () => {
    test("telegram dialog: person, recruiter handle, own excluded, vacancy ref and resume link", async () => {
      const tenant = await seedTenant("psync-tg")
      const known = digits()
      const pending = digits()
      const knownVacancy = await seedVacancyWithExternal(known, "Backend")
      const resumeId = await seedResume({
        userId: tenant.userId,
        accountId: tenant.accountId,
        title: "Backend dev"
      })
      await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: knownVacancy,
        resumeId,
        state: "submitted"
      })
      // Профиль hh указывает тот же @username, что и у аккаунта Telegram.
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.insert(hhAccountContact).values({
            userId: tenant.userId,
            hhAccountId: tenant.accountId,
            kind: "telegram",
            value: "@my_tg"
          })
        )
      )

      const fake = new FakeTelegramGateway({
        me: { id: "42", username: "my_tg", firstName: "Me", lastName: null, phone: null },
        dialogs: [dialog("5001", null)],
        messages: {
          "5001": [
            message("1", "out", "Мой тг @own_handle, пишите"),
            message(
              "2",
              "in",
              `Здравствуйте! Мой тг @recruiter_hr. Вакансии https://hh.ru/vacancy/${known} и https://hh.ru/vacancy/${pending}`
            )
          ]
        }
      })
      fake.authorized = true
      const account = await telegramAccountUpsert(tenant.userId, {
        label: "hr",
        apiId: 123456,
        apiHash: "0123456789abcdef0123456789abcdef"
      })

      const sync = await telegramSyncNow(tenant.userId, account.id, { telegramGateway: fake })
      expect(sync.errors).toEqual([])
      expect(sync.inserted).toBe(2)

      const contacts = await contactRowsOf(tenant.userId)
      const values = contacts.map((row) => `${row.kind}:${row.value}`).sort()
      expect(values).toEqual(["telegram:@recruiter_hr", "telegram_id:5001"])
      expect(values.join()).not.toContain("own_handle")
      expect(new Set(contacts.map((row) => row.personId)).size).toBe(1)
      expect(contacts.every((row) => row.personId !== null)).toBe(true)

      const people = await personList(tenant.userId)
      expect(people.total).toBe(1)

      const conversationId = (await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`select id::text as id from conversation where user_id = ${tenant.userId}`)
        )
      )).rows[0] as { id: string }
      const conversation = await conversationRowOf(conversationId.id)
      expect(conversation.personId).toBe(people.items[0]!.id)

      const links = await linkedVacanciesOf(conversationId.id)
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({ vacancyId: knownVacancy, kind: "primary" })
      expect((await vacancyRefsOf(conversationId.id)).map((row) => row.externalId)).toEqual([pending])

      const resumes = await resumeLinksOf(conversationId.id)
      expect(resumes).toHaveLength(1)
      expect(resumes[0]).toMatchObject({ resume_id: resumeId, source: "tg_vacancy_account" })

      // Вакансия появляется через общий ингест: ссылка разрешается сама.
      const draft: VacancyDraft = {
        externalId: pending,
        canonicalUrl: `https://hh.ru/vacancy/${pending}`,
        title: "Frontend",
        descriptionText: "Описание",
        employer: { externalId: `e-${pending}`, name: "Acme" }
      }
      await corpusIngest(tenant.userId, [draft])
      expect(await vacancyRefsOf(conversationId.id)).toHaveLength(0)
      expect(await linkedVacanciesOf(conversationId.id)).toHaveLength(2)
    })

    test("telegram sync is incremental by the highest stored message id", async () => {
      const tenant = await seedTenant("psync-inc")
      const fake = new FakeTelegramGateway({
        me: { id: "43", username: "inc_me", firstName: "Me", lastName: null, phone: null },
        dialogs: [dialog("6001", "inc_hr")],
        messages: { "6001": [message("1", "in", "Привет"), message("2", "in", "Как дела")] }
      })
      fake.authorized = true
      const account = await telegramAccountUpsert(tenant.userId, {
        label: "inc",
        apiId: 123456,
        apiHash: "0123456789abcdef0123456789abcdef"
      })

      const first = await telegramSyncNow(tenant.userId, account.id, { telegramGateway: fake })
      expect(first.inserted).toBe(2)

      const again = await telegramSyncNow(tenant.userId, account.id, { telegramGateway: fake })
      expect(again.inserted).toBe(0)
      expect(again.skipped).toBe(0)

      fake.chatMessages.get("6001")!.push(message("3", "in", "Новое"))
      const third = await telegramSyncNow(tenant.userId, account.id, { telegramGateway: fake })
      expect(third.inserted).toBe(1)
      expect(third.skipped).toBe(0)

      const conversationId = (await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`select id::text as id from conversation where user_id = ${tenant.userId}`)
        )
      )).rows[0] as { id: string }
      expect(await messageIdsOf(conversationId.id)).toEqual(["1", "2", "3"])
    })

    test("hh chat import creates the person, its contact and the exact resume link", async () => {
      const tenant = await seedTenant("psync-hh")
      const vacancyId = await seedVacancyWithExternal(digits(), "Platform")
      const resumeId = await seedResume({
        userId: tenant.userId,
        accountId: tenant.accountId,
        title: "Platform dev"
      })
      const applicationId = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        resumeId,
        state: "submitted"
      })
      const chatId = digits()
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`update application set hh_chat_id = ${chatId} where id = ${applicationId}`)
        )
      )

      const chat: ParsedChat = {
        chatId,
        vacancyExternalId: null,
        resumeExternalId: null,
        personName: "Мария HR",
        hasMore: false,
        messages: [
          {
            externalId: "1",
            direction: "in",
            sentAt: new Date(Date.UTC(2026, 10, 2, 9)),
            kind: "text",
            text: "Добрый день! Пишите мне: maria@corp.ru",
            authorName: "Мария HR"
          },
          {
            externalId: "2",
            direction: "out",
            sentAt: new Date(Date.UTC(2026, 10, 2, 10)),
            kind: "text",
            text: "Моя почта me@mail.ru",
            authorName: null
          }
        ]
      }
      await runAs(
        "owner",
        ownerTx((tx) =>
          importChat(tx, { userId: tenant.userId, hhAccountId: tenant.accountId, vacancyId, chat })
        )
      )

      const contacts = await contactRowsOf(tenant.userId)
      expect(contacts.map((row) => `${row.kind}:${row.value}:${row.source}`)).toEqual([
        "email:maria@corp.ru:hh_chat"
      ])
      expect(contacts[0]?.personId).not.toBeNull()

      const people = await personList(tenant.userId)
      expect(people.total).toBe(1)
      expect(people.items[0]?.displayName).toBe("Мария HR")

      const conversationId = (await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`select id::text as id from conversation where user_id = ${tenant.userId}`)
        )
      )).rows[0] as { id: string }
      expect((await conversationRowOf(conversationId.id)).personId).toBe(people.items[0]!.id)
      const resumes = await resumeLinksOf(conversationId.id)
      expect(resumes).toHaveLength(1)
      expect(resumes[0]).toMatchObject({ resume_id: resumeId, confidence: 1, source: "hh_chat" })
      expect((await linkedVacanciesOf(conversationId.id))[0]).toMatchObject({
        vacancyId,
        kind: "primary",
        source: "hh_chat"
      })
    })

    test("bulk chat sync enqueues only chats without a fresh copy and respects the limit", async () => {
      const tenant = await seedTenant("psync-bulk")
      const chats: Array<string> = []
      for (let index = 0; index < 3; index += 1) {
        const vacancyId = await seedVacancyWithExternal(digits(), `V${index}`)
        const resumeId = await seedResume({
          userId: tenant.userId,
          accountId: tenant.accountId,
          title: `R${index}`
        })
        const applicationId = await seedApplication({
          userId: tenant.userId,
          accountId: tenant.accountId,
          vacancyId,
          resumeId,
          state: "submitted"
        })
        const chatId = digits()
        chats.push(chatId)
        await runAs(
          "owner",
          ownerTx((tx) =>
            tx.execute(sql`update application set hh_chat_id = ${chatId} where id = ${applicationId}`)
          )
        )
      }
      // Один чат уже сохранён свежим.
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: chats[0]!,
        accountId: tenant.accountId,
        messages: [{ direction: "in", text: "привет" }]
      })

      const run = (limit: number) =>
        runAs(
          tenant.userId,
          Effect.gen(function*() {
            const database = yield* Database
            return yield* database.asUser(tenant.userId, (tx) =>
              enqueueChatReads(tx, tenant.userId, { limit })
            )
          })
        )

      const first = await run(1)
      expect(first).toEqual({ queued: 1, candidates: 2 })
      // Задание уже стоит в очереди: второй проход берёт следующий чат, не дублируя.
      const second = await run(5)
      expect(second.queued).toBe(1)
      const third = await run(5)
      expect(third.queued).toBe(0)
    })
  })
}
