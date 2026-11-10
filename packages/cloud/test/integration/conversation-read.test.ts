/** Integration: прочитано/непрочитано, ConversationsSearch и отправитель письма. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import * as ConversationRepository from "../../src/repositories/ConversationRepository.ts"
import { ConversationService } from "../../src/services/ConversationService.ts"
import { OverviewService } from "../../src/services/OverviewService.ts"
import {
  createTestDatabase,
  dropTestDatabase,
  integrationEnabled,
  migrateTestDatabase,
  ownerTx,
  runAs,
  seedTenant,
  seedVacancyForEmployer,
  serverUrl,
  testDatabaseUrl
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

  const minutes = (n: number) => new Date(Date.UTC(2026, 10, 1, 12, n))

  /** Диалог так, как его пишет синк: upsert + сообщения. */
  const seedConversation = (
    userId: string,
    input: {
      readonly channel: "mail" | "telegram" | "hh_chat"
      readonly accountId?: string
      readonly externalId: string
      readonly personName?: string
      readonly title?: string
      readonly unreadCount?: number
      readonly messages: ReadonlyArray<{
        readonly id: string
        readonly direction: "in" | "out"
        readonly at: number
        readonly text?: string
      }>
      readonly vacancyId?: string
    }
  ) =>
    runAs(
      userId,
      ownerTx((tx) =>
        Effect.gen(function*() {
          const id = yield* ConversationRepository.upsert(tx, {
            userId,
            channel: input.channel,
            accountId: input.accountId ?? "acc",
            externalId: input.externalId,
            title: input.title ?? null,
            personName: input.personName ?? null,
            lastMessageAt: minutes(Math.max(...input.messages.map((m) => m.at))),
            unreadCount: input.unreadCount ?? 0
          })
          yield* ConversationRepository.appendMessages(
            tx,
            userId,
            id,
            input.messages.map((m) => ({
              externalId: m.id,
              direction: m.direction,
              sentAt: minutes(m.at),
              text: m.text ?? null
            }))
          )
          if (input.vacancyId !== undefined) {
            yield* ConversationRepository.linkVacancy(tx, {
              userId,
              conversationId: id,
              vacancyId: input.vacancyId
            })
          }
          return id
        })
      )
    )

  /** То, что делает синк на очередном проходе: перезаписывает счётчик источника. */
  const syncAgain = (
    userId: string,
    input: { readonly channel: "mail" | "telegram" | "hh_chat"; readonly externalId: string; readonly unreadCount: number }
  ) =>
    runAs(
      userId,
      ownerTx((tx) =>
        ConversationRepository.upsert(tx, {
          userId,
          channel: input.channel,
          accountId: "acc",
          externalId: input.externalId,
          unreadCount: input.unreadCount
        })
      )
    )

  const appendInbound = (userId: string, conversationId: string, id: string, at: number) =>
    runAs(
      userId,
      ownerTx((tx) =>
        ConversationRepository.appendMessages(tx, userId, conversationId, [
          { externalId: id, direction: "in", sentAt: minutes(at), text: "новое" }
        ])
      )
    )

  const service = <A, E>(userId: string, use: (s: ConversationService["Service"]) => Effect.Effect<A, E, never>) =>
    runAs(
      userId,
      Effect.gen(function*() {
        return yield* use(yield* ConversationService)
      })
    )

  const search = (userId: string, filter: Parameters<ConversationService["Service"]["search"]>[0] = {}) =>
    service(userId, (s) => s.search(filter))
  const markRead = (userId: string, id: string) => service(userId, (s) => s.markRead(id))
  const markUnread = (userId: string, id: string) => service(userId, (s) => s.markUnread(id))

  describe("conversation read state", () => {
    test("telegram: счётчик источника, прочитано остаётся прочитанным, новое входящее возвращает непрочитанное", async () => {
      const t = await seedTenant("read-tg")
      const id = await seedConversation(t.userId, {
        channel: "telegram",
        externalId: "tg-1",
        personName: "Анна",
        unreadCount: 3,
        messages: [
          { id: "m1", direction: "in", at: 1 },
          { id: "m2", direction: "in", at: 2 }
        ]
      })

      expect((await search(t.userId)).items[0]!.unreadCount).toBe(3)

      const read = await markRead(t.userId, id)
      expect(read.unreadCount).toBe(0)
      expect(read.readAt).not.toBeNull()

      // Синк снова пишет счётчик источника (Telegram ещё не знает о прочтении).
      await syncAgain(t.userId, { channel: "telegram", externalId: "tg-1", unreadCount: 3 })
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(0)

      // Те же сообщения приходят повторно: идемпотентный апдейт не воскрешает диалог.
      await appendInbound(t.userId, id, "m2", 2)
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(0)

      // Новое входящее: снова непрочитан, считаются только новее прочитанного.
      await appendInbound(t.userId, id, "m3", 5)
      await appendInbound(t.userId, id, "m4", 6)
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(2)

      // Исходящее не делает диалог непрочитанным.
      const again = await markRead(t.userId, id)
      expect(again.unreadCount).toBe(0)
      await runAs(
        t.userId,
        ownerTx((tx) =>
          ConversationRepository.appendMessages(tx, t.userId, id, [
            { externalId: "out1", direction: "out", sentAt: minutes(9), text: "ответ" }
          ])
        )
      )
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(0)
    })

    test("почта: новый диалог непрочитан, прочтение держится, ручное «непрочитано»", async () => {
      const t = await seedTenant("read-mail")
      const id = await seedConversation(t.userId, {
        channel: "mail",
        externalId: "thread-1",
        messages: [
          { id: "a", direction: "in", at: 1 },
          { id: "b", direction: "out", at: 2 }
        ]
      })
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(1)

      expect((await markRead(t.userId, id)).unreadCount).toBe(0)
      // Повторное прочтение не двигает отметку назад и не ломается.
      expect((await markRead(t.userId, id)).unreadCount).toBe(0)

      const unread = await markUnread(t.userId, id)
      expect(unread.unreadCount).toBe(1)
      // Синк не снимает ручную отметку.
      await syncAgain(t.userId, { channel: "mail", externalId: "thread-1", unreadCount: 0 })
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(1)

      expect((await markRead(t.userId, id)).unreadCount).toBe(0)
      await appendInbound(t.userId, id, "c", 10)
      expect((await search(t.userId)).items[0]!.unreadCount).toBe(1)
    })

    test("чужой диалог и несуществующий id дают NotFound; markRead не видит чужого", async () => {
      const a = await seedTenant("read-a")
      const b = await seedTenant("read-b")
      const id = await seedConversation(a.userId, {
        channel: "mail",
        externalId: "iso-1",
        messages: [{ id: "x", direction: "in", at: 1 }]
      })
      const failure = await runAs(
        b.userId,
        Effect.gen(function*() {
          const s = yield* ConversationService
          return yield* Effect.flip(s.markRead(id))
        })
      )
      expect((failure as { _tag: string })._tag).toBe("NotFound")
      expect((await search(a.userId)).items[0]!.unreadCount).toBe(1)
      expect(await search(b.userId)).toEqual({ items: [], total: 0, unreadTotal: 0 })
    })
  })

  describe("ConversationsSearch", () => {
    test("страницы, total, unreadTotal, фильтры, поиск и контекст вакансии", async () => {
      const t = await seedTenant("search")
      const { vacancyId } = await seedVacancyForEmployer({
        label: "srch",
        title: "Senior SRE",
        employerExternalId: `emp-${t.userId}`,
        employerName: "Acme Corp"
      })

      const ids: Array<string> = []
      for (let i = 0; i < 5; i += 1) {
        ids.push(
          await seedConversation(t.userId, {
            channel: i < 3 ? "mail" : "hh_chat",
            accountId: i < 3 ? "mail-acc" : t.accountId,
            externalId: `s-${i}`,
            personName: i === 1 ? "Борис Петров" : `Контакт ${i}`,
            title: i === 2 ? "Оффер на позицию" : null as unknown as string,
            messages: [{ id: `s${i}`, direction: "in", at: i + 1, text: i === 4 ? "Приходите на собеседование в среду" : "привет" }],
            ...(i === 4 ? { vacancyId } : {})
          })
        )
      }
      // Прочитан самый старый.
      await markRead(t.userId, ids[0]!)

      const all = await search(t.userId, { limit: 2 })
      expect(all.total).toBe(5)
      expect(all.unreadTotal).toBe(4)
      expect(all.items).toHaveLength(2)
      // Сортировка по последнему сообщению, свежие первыми.
      expect(all.items.map((i) => i.externalId)).toEqual(["s-4", "s-3"])

      const second = await search(t.userId, { limit: 2, offset: 2 })
      expect(second.items.map((i) => i.externalId)).toEqual(["s-2", "s-1"])
      const last = await search(t.userId, { limit: 2, offset: 4 })
      expect(last.items.map((i) => i.externalId)).toEqual(["s-0"])
      expect(last.total).toBe(5)

      const top = all.items[0]!
      expect(top.vacancyTitle).toBe("Senior SRE")
      expect(top.employerName).toBe("Acme Corp")
      expect(top.hhAccountId).toBe(t.accountId)
      expect(all.items[1]!.vacancyTitle).toBeNull()

      const unread = await search(t.userId, { unread: true })
      expect(unread.total).toBe(4)
      expect(unread.items.map((i) => i.externalId)).not.toContain("s-0")
      const unreadPaged = await search(t.userId, { unread: true, limit: 3 })
      expect(unreadPaged.items).toHaveLength(3)
      expect(unreadPaged.total).toBe(4)

      const mail = await search(t.userId, { channel: "mail" })
      expect(mail.total).toBe(3)
      expect(mail.unreadTotal).toBe(2)
      const hh = await search(t.userId, { channel: "hh_chat", unread: true })
      expect(hh.total).toBe(2)

      // Поиск: имя, заголовок, текст сообщения; спецсимволы экранируются.
      expect((await search(t.userId, { search: "борис" })).items.map((i) => i.externalId)).toEqual(["s-1"])
      expect((await search(t.userId, { search: "оффер" })).items.map((i) => i.externalId)).toEqual(["s-2"])
      expect((await search(t.userId, { search: "собеседование" })).items.map((i) => i.externalId)).toEqual(["s-4"])
      expect((await search(t.userId, { search: "100%" })).total).toBe(0)
      expect((await search(t.userId, { search: "собеседование", unread: true })).total).toBe(1)

      // Архивные: фильтр archived=false их скрывает.
      await runAs(
        t.userId,
        ownerTx((tx) =>
          tx.execute(sql`update conversation set archived = true where id = ${ids[1]!}`)
        )
      )
      const live = await search(t.userId, { archived: false })
      expect(live.total).toBe(4)
      expect(live.items.map((i) => i.externalId)).not.toContain("s-1")
      expect(live.unreadTotal).toBe(3)
    })

    test("изоляция арендаторов", async () => {
      const a = await seedTenant("search-a")
      const b = await seedTenant("search-b")
      await seedConversation(a.userId, {
        channel: "mail",
        externalId: "own",
        personName: "Секрет Секретович",
        messages: [{ id: "z", direction: "in", at: 1, text: "секретный текст" }]
      })
      const other = await search(b.userId, { search: "секретный" })
      expect(other).toEqual({ items: [], total: 0, unreadTotal: 0 })
      expect((await search(a.userId, { search: "секретный" })).total).toBe(1)
    })

    test("снимок обзора считает непрочитанные тем же правилом", async () => {
      const t = await seedTenant("overview-unread")
      const id = await seedConversation(t.userId, {
        channel: "mail",
        externalId: "ov-1",
        messages: [{ id: "o", direction: "in", at: 1 }]
      })
      const unreadInOverview = () =>
        runAs(
          t.userId,
          Effect.gen(function*() {
            const overview = yield* OverviewService
            return (yield* overview.get({})).inbox.unreadConversations
          })
        )
      expect(await unreadInOverview()).toBe(1)
      await markRead(t.userId, id)
      expect(await unreadInOverview()).toBe(0)
      await appendInbound(t.userId, id, "o2", 4)
      expect(await unreadInOverview()).toBe(1)
    })
  })
}
