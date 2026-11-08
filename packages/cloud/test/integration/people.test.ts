/** Integration: people. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  contactConfirm,
  contactReject,
  contactRowsOf,
  conversationRowOf,
  createTestDatabase,
  dropTestDatabase,
  integrationEnabled,
  linkedVacanciesOf,
  migrateTestDatabase,
  personGet,
  personList,
  personMerge,
  personRowsFor,
  personSplit,
  relink,
  seedConversation,
  seedTenant,
  seedVacancyWithExternal,
  serverUrl,
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

  describe("people", () => {
    test("a self-referenced contact creates a person, links the dialog and is idempotent", async () => {
      const tenant = await seedTenant("people-create")
      const id = await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        personName: "Анна Рекрутер",
        messages: [
          { direction: "in", text: "Здравствуйте! Пишите мне: anna@corp.ru" },
          { direction: "out", text: "Мой телеграм @applicant_me" }
        ]
      })

      const first = await relink(tenant.userId)
      expect(first.conversations).toBe(1)
      expect(first.peopleCreated).toBe(1)

      const contacts = await contactRowsOf(tenant.userId)
      expect(contacts.map((row) => row.value)).toEqual(["anna@corp.ru"])
      expect(contacts[0]?.personLink).toBe("auto")

      const second = await relink(tenant.userId, id)
      expect(second.peopleCreated).toBe(0)
      expect(await personRowsFor(tenant.userId)).toHaveLength(1)

      const conversation = await conversationRowOf(id)
      const people = await personList(tenant.userId)
      expect(people.total).toBe(1)
      expect(conversation.personId).toBe(people.items[0]!.id)

      const record = await personGet(tenant.userId, people.items[0]!.id)
      expect(record.displayName).toBe("Анна Рекрутер")
      expect(record.contacts).toHaveLength(1)
      expect(record.conversations).toHaveLength(1)
    })

    test("the same email in a second dialog attaches to the same person", async () => {
      const tenant = await seedTenant("people-attach")
      await seedConversation(tenant.userId, {
        channel: "mail",
        externalId: `thread-${digits()}`,
        messages: [{ direction: "in", text: "Мой email: boss@corp.ru" }]
      })
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Звоните, пишите мне на boss@corp.ru" }]
      })

      const result = await relink(tenant.userId)
      expect(result.peopleCreated).toBe(1)
      const people = await personList(tenant.userId)
      expect(people.total).toBe(1)
      expect(people.items[0]?.conversationCount).toBe(2)
    })

    test("a mentioned contact stays unlinked without a counterparty identity", async () => {
      const tenant = await seedTenant("people-mentioned")
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Вакансия описана здесь, почта hr@corp.ru" }]
      })
      const result = await relink(tenant.userId)
      expect(result.peopleCreated).toBe(0)
      expect(await personRowsFor(tenant.userId)).toHaveLength(0)
    })

    test("a suggested link can be confirmed or rejected; a manual one survives relink", async () => {
      const tenant = await seedTenant("people-suggest")
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [
          { direction: "in", text: "Мой email lead@corp.ru. Коллега: его телеграм @colleague_dev" }
        ]
      })
      await relink(tenant.userId)

      const contacts = await contactRowsOf(tenant.userId)
      const suggested = contacts.find((row) => row.value === "@colleague_dev")
      expect(suggested?.personLink).toBe("suggested")

      const confirmed = await contactConfirm(tenant.userId, suggested!.id)
      expect(confirmed.personLink).toBe("manual")
      await relink(tenant.userId)
      const after = await contactRowsOf(tenant.userId)
      expect(after.find((row) => row.value === "@colleague_dev")?.personLink).toBe("manual")

      const other = after.find((row) => row.value === "lead@corp.ru")!
      const split = await personSplit(tenant.userId, other.id)
      expect(split.contacts.map((item) => item.value)).toEqual(["lead@corp.ru"])
      expect(split.contacts[0]?.personLink).toBe("manual")

      const rejected = await contactReject(tenant.userId, suggested!.id)
      // Подтверждённая привязка уже ручная: отклонить её нельзя.
      expect(rejected.personLink).toBe("manual")
    })

    test("two persons are never merged automatically, only on request", async () => {
      const tenant = await seedTenant("people-merge")
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Мой email: a@corp.ru" }]
      })
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Мой телефон +7 999 123-45-67" }]
      })
      await relink(tenant.userId)
      expect((await personList(tenant.userId)).total).toBe(2)

      // Третий диалог несёт оба сигнала сразу: слияния нет, есть предложение.
      await seedConversation(tenant.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Мои контакты: a@corp.ru, +7 999 123-45-67" }]
      })
      const result = await relink(tenant.userId)
      expect(result.mergeSuggestions).toHaveLength(1)
      expect((await personList(tenant.userId)).total).toBe(2)

      const [left, right] = (await personList(tenant.userId)).items
      const merged = await personMerge(tenant.userId, left!.id, right!.id)
      expect(merged.contacts).toHaveLength(2)
      expect((await personList(tenant.userId)).total).toBe(1)
      expect(await personRowsFor(tenant.userId)).toHaveLength(2)
      // Слитый человек по-прежнему открывается и ведёт к победителю.
      expect((await personGet(tenant.userId, right!.id)).id).toBe(left!.id)
    })

    test("a vacancy url becomes primary when the vacancy exists, a pending ref otherwise", async () => {
      const tenant = await seedTenant("people-vacancy")
      const known = digits()
      const unknown = digits()
      const vacancyId = await seedVacancyWithExternal(known, "Backend")
      const id = await seedConversation(tenant.userId, {
        channel: "mail",
        externalId: `thread-${digits()}`,
        messages: [
          {
            direction: "in",
            text: `Мы по вакансии https://hh.ru/vacancy/${known}, а ещё https://hh.ru/vacancy/${unknown}`
          }
        ]
      })

      const result = await relink(tenant.userId, id)
      expect(result.vacancyLinks).toBe(1)

      const links = await linkedVacanciesOf(id)
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({ vacancyId, kind: "primary", source: "url_in_text" })
      expect((await vacancyRefsOf(id)).map((row) => row.externalId)).toEqual([unknown])

      // Вакансия появилась позже: ссылка разрешается и исчезает.
      await seedVacancyWithExternal(unknown, "Frontend")
      await relink(tenant.userId, id)
      expect(await vacancyRefsOf(id)).toHaveLength(0)
      expect(await linkedVacanciesOf(id)).toHaveLength(2)
    })

    test("people are isolated per user", async () => {
      const owner = await seedTenant("people-owner")
      const stranger = await seedTenant("people-stranger")
      await seedConversation(owner.userId, {
        channel: "hh_chat",
        externalId: `chat-${digits()}`,
        messages: [{ direction: "in", text: "Мой email: private@corp.ru" }]
      })
      await relink(owner.userId)
      expect((await personList(stranger.userId)).total).toBe(0)
      const mine = await personList(owner.userId)
      await expect(personGet(stranger.userId, mine.items[0]!.id)).rejects.toBeDefined()
    })
  })
}
