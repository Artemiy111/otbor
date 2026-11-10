/** Integration: VacanciesList с решением и откликом области (аккаунт, резюме). See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { CorpusService } from "../../src/services/CorpusService.ts"
import {
  addAccount,
  createTestDatabase,
  dropTestDatabase,
  integrationEnabled,
  migrateTestDatabase,
  ownerTx,
  runAs,
  seedResume,
  seedTenant,
  seedVacancyTitled,
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

  type ListInput = Parameters<CorpusService["Service"]["list"]>[0]
  const list = (userId: string, input: ListInput) =>
    runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* CorpusService).list(input)
      })
    )

  const exec = (userId: string, query: ReturnType<typeof sql>) => runAs(userId, ownerTx((tx) => tx.execute(query)))

  let hash = 0
  const decide = (
    userId: string,
    accountId: string,
    vacancyId: string,
    fields: {
      readonly verdict: "apply" | "draft" | "skip"
      readonly fit: number
      readonly reasons?: ReadonlyArray<object>
      readonly resumeId?: string
      readonly createdAt?: string
    }
  ) =>
    exec(
      userId,
      sql`
        insert into decision (user_id, hh_account_id, resume_id, vacancy_id, verdict, fit, priority, reasons,
                              policy_version, input_hash, created_at)
        values (${userId}, ${accountId}, ${fields.resumeId ?? null}, ${vacancyId}, ${fields.verdict}, ${fields.fit}, 0,
                ${JSON.stringify(fields.reasons ?? [])}::jsonb, 1, ${`h-${hash++}`},
                ${fields.createdAt ?? new Date().toISOString()}::timestamptz)
      `
    )

  const apply = (
    userId: string,
    accountId: string,
    vacancyId: string,
    state: string,
    extra: { readonly blockedReason?: string; readonly hhStatus?: string; readonly autoRun?: string } = {}
  ) =>
    exec(
      userId,
      sql`
        insert into application (user_id, hh_account_id, vacancy_id, state, blocked_reason, hh_status, auto_run)
        values (${userId}, ${accountId}, ${vacancyId}, ${state}, ${extra.blockedReason ?? null},
                ${extra.hhStatus ?? null}, ${extra.autoRun ?? null})
      `
    )

  describe("VacanciesList: решение и отклик области", () => {
    test("несёт решение и отклик, сортирует по соответствию и приоритету, фильтрует, не течёт между пользователями", async () => {
      const mine = await seedTenant("vl-mine")
      const second = await addAccount(mine.userId, "vl-second")
      const other = await seedTenant("vl-other")

      const tag = `vlq${Date.now()}`
      const good = await seedVacancyTitled("vl-good", `${tag} good`)
      const mid = await seedVacancyTitled("vl-mid", `${tag} mid`)
      const skipped = await seedVacancyTitled("vl-skip", `${tag} skipped`)
      const fresh = await seedVacancyTitled("vl-fresh", `${tag} fresh`)
      const sent = await seedVacancyTitled("vl-sent", `${tag} sent`)

      await decide(mine.userId, mine.accountId, good, { verdict: "apply", fit: 90, reasons: [{ code: "skill_match" }] })
      await decide(mine.userId, mine.accountId, mid, { verdict: "draft", fit: 60 })
      await decide(mine.userId, mine.accountId, skipped, {
        verdict: "skip",
        fit: 30,
        reasons: [{ code: "fit" }, { code: "blocked_filter", detail: "зарплата" }]
      })
      // Старое решение не перекрывает новое: берётся самое свежее.
      await decide(mine.userId, mine.accountId, sent, {
        verdict: "skip",
        fit: 10,
        createdAt: "2020-01-01T00:00:00Z"
      })
      await decide(mine.userId, mine.accountId, sent, { verdict: "apply", fit: 75 })
      // Решение другого аккаунта того же пользователя в область не попадает.
      await decide(mine.userId, second, fresh, { verdict: "apply", fit: 99 })
      // Чужие решение и отклик на те же вакансии.
      await decide(other.userId, other.accountId, good, { verdict: "skip", fit: 1, reasons: [{ code: "blocked_blacklist" }] })
      await apply(other.userId, other.accountId, good, "submitted", { hhStatus: "OTHER" })

      await apply(mine.userId, mine.accountId, sent, "submitted", { hhStatus: "RESPONSE" })
      await apply(mine.userId, mine.accountId, mid, "draft", { autoRun: "drafts" })
      await apply(mine.userId, second, good, "submitted")

      const all = await list(mine.userId, { search: tag, limit: 50 })
      expect(all.total).toBe(5)
      const byTitle = new Map(all.items.map((item) => [item.title, item]))

      // Область по умолчанию - основной аккаунт: первый созданный.
      expect(all.scopeHhAccountId as string | null).toBe(mine.accountId)

      const goodItem = byTitle.get(`${tag} good`)!
      expect(goodItem.decision).toMatchObject({ verdict: "apply", fit: 90, topReason: { code: "skill_match" }, resumeId: null })
      // Чужое не просачивается: ни решение skip с fit 1, ни отклик другого пользователя, ни отклик второго аккаунта.
      expect(goodItem.application).toBeNull()

      const skipItem = byTitle.get(`${tag} skipped`)!
      expect(skipItem.decision?.verdict).toBe("skip")
      expect(skipItem.decision?.topReason).toEqual({ code: "blocked_filter", detail: "зарплата" })

      const sentItem = byTitle.get(`${tag} sent`)!
      expect(sentItem.decision).toMatchObject({ verdict: "apply", fit: 75 })
      expect(sentItem.application).toMatchObject({ state: "submitted", hhStatus: "RESPONSE", blockedReason: null })

      expect(byTitle.get(`${tag} mid`)!.application).toMatchObject({ state: "draft", autoRun: "drafts" })
      expect(byTitle.get(`${tag} fresh`)!.decision).toBeNull()

      // Счётчики быстрых фильтров считаются по набору без verdict / applied.
      expect(all.counts).toEqual({ all: 5, apply: 2, applied: 1, notApplied: 4 })

      // Сортировка по соответствию: без решения - в конец в обоих направлениях.
      const byFit = await list(mine.userId, { search: tag, sort: { key: "fit", direction: "desc" } })
      expect(byFit.items.map((item) => item.title)).toEqual([
        `${tag} good`,
        `${tag} sent`,
        `${tag} mid`,
        `${tag} skipped`,
        `${tag} fresh`
      ])
      const byFitAsc = await list(mine.userId, { search: tag, sort: { key: "fit", direction: "asc" } })
      expect(byFitAsc.items.map((item) => item.title)).toEqual([
        `${tag} skipped`,
        `${tag} mid`,
        `${tag} sent`,
        `${tag} good`,
        `${tag} fresh`
      ])
      const byPriority = await list(mine.userId, { search: tag, sort: { key: "priority", direction: "desc" } })
      // Приоритет есть только у apply (fit x свежесть, без даты публикации 0.5): 90 > 75, остальные - сохранённый 0.
      expect(byPriority.items.slice(0, 2).map((item) => item.title)).toEqual([`${tag} good`, `${tag} sent`])
      expect(byPriority.items[0]!.decision!.priority).toBe(45)
      expect(byPriority.items.at(-1)!.decision).toBeNull()

      // Фильтры по решению.
      const titles = async (input: Partial<ListInput>) =>
        (await list(mine.userId, { search: tag, sort: { key: "fit", direction: "desc" }, ...input })).items.map(
          (item) => item.title.replace(`${tag} `, "")
        )
      expect(await titles({ verdict: "apply" })).toEqual(["good", "sent"])
      expect(await titles({ verdict: "draft" })).toEqual(["mid"])
      expect(await titles({ verdict: "skip" })).toEqual(["skipped"])
      expect(await titles({ verdict: "none" })).toEqual(["fresh"])
      expect((await list(mine.userId, { search: tag, verdict: "apply" })).total).toBe(2)

      // Фильтр по отклику: черновик не считается откликом.
      expect(await titles({ applied: "yes" })).toEqual(["sent"])
      expect(await titles({ applied: "no" })).toEqual(["good", "mid", "skipped", "fresh"])
      expect(await titles({ applied: "no", verdict: "apply" })).toEqual(["good"])

      // Явный второй аккаунт: его решение и его отклик.
      const scoped = await list(mine.userId, { search: tag, hhAccountId: second })
      expect(scoped.scopeHhAccountId as string | null).toBe(second)
      const scopedByTitle = new Map(scoped.items.map((item) => [item.title.replace(`${tag} `, ""), item]))
      expect(scopedByTitle.get("fresh")!.decision).toMatchObject({ verdict: "apply", fit: 99 })
      expect(scopedByTitle.get("good")!.application).toMatchObject({ state: "submitted" })
      expect(scopedByTitle.get("good")!.decision).toBeNull()

      // Основной аккаунт можно сменить: область следует за ним.
      await exec(mine.userId, sql`update hh_account set is_default = false where user_id = ${mine.userId}`)
      await exec(mine.userId, sql`update hh_account set is_default = true where id = ${second}`)
      expect((await list(mine.userId, { search: tag })).scopeHhAccountId as string | null).toBe(second)
      await exec(mine.userId, sql`update hh_account set is_default = false where user_id = ${mine.userId}`)
      await exec(mine.userId, sql`update hh_account set is_default = true where id = ${mine.accountId}`)

      // Чужой пользователь видит те же вакансии со своими данными.
      const theirs = await list(other.userId, { search: tag })
      const theirGood = theirs.items.find((item) => item.title.endsWith("good"))!
      expect(theirGood.decision).toMatchObject({ verdict: "skip", fit: 1, topReason: { code: "blocked_blacklist" } })
      expect(theirGood.application).toMatchObject({ state: "submitted", hhStatus: "OTHER" })
      expect(theirs.items.find((item) => item.title.endsWith("sent"))!.decision).toBeNull()
    })

    test("резюме сужает область, seenSince режет по первому появлению, без аккаунтов решений нет", async () => {
      const tenant = await seedTenant("vl-resume")
      const tag = `vlr${Date.now()}`
      const vacancy = await seedVacancyTitled("vlr-a", `${tag} a`)
      const old = await seedVacancyTitled("vlr-old", `${tag} old`)
      await exec("owner", sql`update vacancy set created_at = now() - interval '10 days' where id = ${old}`)

      const resumeA = await seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "vlr-ra" })
      const resumeB = await seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "vlr-rb" })

      await decide(tenant.userId, tenant.accountId, vacancy, {
        verdict: "apply",
        fit: 80,
        resumeId: resumeA,
        createdAt: "2024-01-01T00:00:00Z"
      })
      await decide(tenant.userId, tenant.accountId, vacancy, { verdict: "skip", fit: 20, resumeId: resumeB })

      // Без резюме берётся самое свежее решение аккаунта, с резюме - решение этого резюме.
      const latest = await list(tenant.userId, { search: tag })
      expect(latest.items.find((item) => item.title.endsWith(" a"))!.decision).toMatchObject({ verdict: "skip", resumeId: resumeB })
      const forA = await list(tenant.userId, { search: tag, resumeId: resumeA })
      expect(forA.items.find((item) => item.title.endsWith(" a"))!.decision).toMatchObject({ verdict: "apply", fit: 80, resumeId: resumeA })

      // seenSince: только вакансии, созданные не раньше границы; счётчик `fresh` отражает то же.
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
      const news = await list(tenant.userId, { search: tag, seenSince: since })
      expect(news.items.map((item) => item.title)).toEqual([`${tag} a`])
      expect(news.counts?.fresh).toBe(1)
      expect(news.counts?.all).toBe(2)
      // freshSince считает «Новые», но выдачу не сужает.
      const counted = await list(tenant.userId, { search: tag, freshSince: since })
      expect(counted.total).toBe(2)
      expect(counted.counts?.fresh).toBe(news.total)
      // Мусорное значение игнорируется, а не роняет запрос.
      expect((await list(tenant.userId, { search: tag, seenSince: "вчера" })).total).toBe(2)

      // Пользователь без аккаунтов: список работает, решений и откликов нет.
      const lonely = `it-vl-lonely-${Date.now()}`
      await exec(lonely, sql`insert into "user" (id, name, email) values (${lonely}, 'lonely', ${`${lonely}@test.local`})`)
      const bare = await list(lonely, { search: tag })
      expect(bare.scopeHhAccountId).toBeNull()
      expect(bare.total).toBe(2)
      expect(bare.items.every((item) => item.decision === null && item.application === null)).toBe(true)
    })
  })
}
