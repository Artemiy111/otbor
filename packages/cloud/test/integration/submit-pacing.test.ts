/**
 * Темп отправок, блокировка после капчи и часовой лимит, по аккаунту hh: claim
 * не выдаёт действующую задачу раньше `submit_next_at`, пока стоит
 * `submit_blocked_at` (капча, снимает оператор) и сверх часового лимита;
 * читающие задачи не затронуты. Время двигается правкой сохранённых моментов.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import type { UserSettings } from "@otbor/contract"
import { Effect } from "effect"
import * as ApplicationRepository from "../../src/repositories/ApplicationRepository.ts"
import { HhAccountService } from "../../src/services/HhAccountService.ts"
import { QueueService } from "../../src/services/QueueService.ts"
import { SettingsService } from "../../src/services/SettingsService.ts"
import {
  claimAsHolder,
  completeJob,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  integrationEnabled,
  leaseNext,
  migrateTestDatabase,
  ownerTx,
  registerHarness,
  runAs,
  runAsFailure,
  seedApplication,
  seedTenant,
  seedVacancy,
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

  const holderName = () => `holder-${randomUUID().slice(0, 8)}`

  const pacingOf = (accountId: string) =>
    runAs(
      "owner",
      ownerTx((tx) =>
        tx
          .execute(sql`
            select extract(epoch from (submit_next_at - now()))::float as next_in,
                   submit_blocked_at as blocked_at,
                   submit_block_reason as reason,
                   submit_resumed_at as resumed_at
            from hh_account where id = ${accountId}
          `)
          .pipe(
            Effect.map((result) =>
              result.rows[0] as {
                next_in: number | null
                blocked_at: Date | null
                reason: string | null
                resumed_at: Date | null
              }
            )
          )
      )
    )

  /** Сдвигает момент темпа в прошлое: «прошло достаточно времени». */
  const elapse = (accountId: string) =>
    runAs(
      "owner",
      ownerTx((tx) =>
        tx.execute(sql`
          update hh_account
          set submit_next_at = submit_next_at - interval '1 hour'
          where id = ${accountId}
        `)
      )
    )

  describe("submit pacing", () => {
    test("a second submit of the account waits for the interval; reads are not paced", async () => {
      const tenant = await seedTenant("pace")
      for (let i = 0; i < 3; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit", priority: 100 - i })
      }
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 1 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 1 })
      const holder = holderName()
      const claim = () =>
        claimAsHolder({
          holder,
          accounts: [tenant.accountId],
          browserConcurrency: 6,
          actingConcurrency: 5,
          submitIntervalSeconds: 60
        })

      const first = await claim()
      expect(first?.job.stage).toBe("submit")
      // Темп назначен: между 60 и 90 секундами (интервал плюс надбавка до 50%).
      const paced = await pacingOf(tenant.accountId)
      expect(paced.next_in!).toBeGreaterThan(55)
      expect(paced.next_in!).toBeLessThanOrEqual(90)

      // Остальные submit ждут, но чтения за ними проходят.
      expect((await claim())?.job.stage).toBe("form_read")
      expect((await claim())?.job.stage).toBe("form_read")
      expect(await claim()).toBeNull()

      // Прошло время: следующий submit выдаётся, и снова ровно один.
      await elapse(tenant.accountId)
      expect((await claim())?.job.stage).toBe("submit")
      expect(await claim()).toBeNull()
    })

    test("another account is paced on its own", async () => {
      const one = await seedTenant("pace-a")
      const two = await seedTenant("pace-b")
      for (const tenant of [one, two]) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      const holder = holderName()
      const claim = (accountId: string) =>
        claimAsHolder({ holder, accounts: [accountId], actingConcurrency: 5, submitIntervalSeconds: 60 })
      expect(await claim(one.accountId)).not.toBeNull()
      expect(await claim(one.accountId)).toBeNull()
      expect(await claim(two.accountId)).not.toBeNull()
    })

    test("letter_attach shares the pace with submit", async () => {
      const tenant = await seedTenant("pace-letter")
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit", priority: 5 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "letter_attach", priority: 1 })
      const holder = holderName()
      const claim = () =>
        claimAsHolder({ holder, accounts: [tenant.accountId], actingConcurrency: 5, submitIntervalSeconds: 60 })
      expect((await claim())?.job.stage).toBe("submit")
      expect(await claim()).toBeNull()
    })

    test("many simultaneous claims lease one acting job", async () => {
      const tenant = await seedTenant("pace-race")
      for (let i = 0; i < 6; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      const holder = holderName()
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          claimAsHolder({ holder, accounts: [tenant.accountId], actingConcurrency: 6, browserConcurrency: 6, submitIntervalSeconds: 60 })
        )
      )
      expect(results.filter((claimed) => claimed !== null)).toHaveLength(1)
    })
  })

  describe("captcha block", () => {
    const setup = async (label: string) => {
      const tenant = await seedTenant(label)
      const harness = await registerHarness(tenant.userId, [tenant.accountId])
      return {
        tenant,
        harness,
        lease: () => leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      }
    }

    const captchaOn = async (
      ctx: Awaited<ReturnType<typeof setup>>,
      job: { id: string; leaseId: string | null; leaseEpoch: number }
    ) =>
      completeJob(ctx.tenant.userId, {
        harnessId: ctx.harness.id,
        token: ctx.harness.token!,
        jobId: job.id,
        leaseId: job.leaseId!,
        epoch: job.leaseEpoch,
        exit: { tag: "captcha", message: "hh asked for a captcha" }
      })

    const resume = (ctx: Awaited<ReturnType<typeof setup>>) =>
      runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* HhAccountService).resumeSubmits(ctx.tenant.accountId)
        })
      )

    const episodes = (ctx: Awaited<ReturnType<typeof setup>>) =>
      runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* HhAccountService).captchaEpisodes({ hhAccountId: ctx.tenant.accountId })
        })
      )

    test("a captcha blocks the submits of the account with no expiry until the operator resumes; reads continue", async () => {
      const ctx = await setup("captcha")
      const { tenant } = ctx
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session", priority: 50 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit", priority: 40 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 1 })

      const session = await ctx.lease()
      expect(session.job?.stage).toBe("session")
      expect((await captchaOn(ctx, session.job!)).accepted).toBe(true)

      const blocked = await pacingOf(tenant.accountId)
      expect(blocked.reason).toBe("captcha")
      expect(blocked.blocked_at).not.toBeNull()

      // submit (приоритет выше) стоит, форма читается.
      expect((await ctx.lease()).job?.stage).toBe("form_read")
      expect((await ctx.lease()).job).toBeNull()

      // Прошло сколько угодно времени: блокировка сама не проходит.
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`update hh_account set submit_blocked_at = now() - interval '30 days' where id = ${tenant.accountId}`)
        )
      )
      await elapse(tenant.accountId)
      expect((await ctx.lease()).job).toBeNull()

      // Вторая капча при блокировке её момент не двигает.
      const firstAt = (await pacingOf(tenant.accountId)).blocked_at!.getTime()
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      const again = await ctx.lease()
      expect(again.job?.stage).toBe("session")
      await captchaOn(ctx, again.job!)
      expect((await pacingOf(tenant.accountId)).blocked_at!.getTime()).toBe(firstAt)
      expect(await episodes(ctx)).toHaveLength(1)

      // Оператор нажал «Продолжить»: submit выдаётся.
      await resume(ctx)
      const resumed = await pacingOf(tenant.accountId)
      expect(resumed.blocked_at).toBeNull()
      expect(resumed.reason).toBeNull()
      expect(resumed.resumed_at).not.toBeNull()
      expect((await ctx.lease()).job?.stage).toBe("submit")
    })

    test("resuming an account that is not blocked changes nothing", async () => {
      const ctx = await setup("captcha-noop")
      const result = await resume(ctx)
      expect(result.applicationIds).toEqual([])
      expect((await pacingOf(ctx.tenant.accountId)).resumed_at).toBeNull()
    })

    test("an episode records how many confirmed submits went out since the last resume, and is closed by the resume", async () => {
      const ctx = await setup("captcha-episode")
      const { tenant } = ctx
      const submitted = async (minutesAgo: number, origin: "otbor" | "imported" = "otbor") =>
        seedApplication({
          userId: tenant.userId,
          accountId: tenant.accountId,
          vacancyId: await seedVacancy("episode"),
          state: "submitted",
          origin,
          submittedAt: new Date(Date.now() - minutesAgo * 60_000)
        })
      await submitted(30)
      await submitted(20)
      await submitted(10)
      await submitted(5, "imported") // чужой отклик не считается

      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      await captchaOn(ctx, (await ctx.lease()).job!)

      const [first] = await episodes(ctx)
      expect(first!.submitsConfirmed).toBe(3)
      expect(first!.resumedAt).toBeNull()
      const minutes = (Date.parse(first!.lastSubmitAt!) - Date.parse(first!.firstSubmitAt!)) / 60_000
      expect(Math.round(minutes)).toBe(20)

      await resume(ctx)
      expect((await episodes(ctx))[0]!.resumedAt).not.toBeNull()

      // Следующий эпизод считает только отклики после возобновления.
      await Bun.sleep(20)
      await submitted(0)
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      await captchaOn(ctx, (await ctx.lease()).job!)
      const list = await episodes(ctx)
      expect(list).toHaveLength(2)
      expect(list[0]!.submitsConfirmed).toBe(1)
    })

    test("resume gives the auto applications held for the captcha back to the runner; manual ones are not touched", async () => {
      const ctx = await setup("captcha-resume-apps")
      const { tenant } = ctx
      const held = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await seedVacancy("held"),
        state: "preparing",
        autoRun: "auto"
      })
      const other = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await seedVacancy("other"),
        state: "preparing",
        autoRun: "auto"
      })
      const setReason = (id: string, reason: string) =>
        runAs(
          "owner",
          ownerTx((tx) =>
            tx.execute(sql`update application set blocked_reason = ${reason}, retry_at = null, last_error = 'x' where id = ${id}`)
          )
        )
      await setReason(held, "captcha")
      await setReason(other, "daily_cap")
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      await captchaOn(ctx, (await ctx.lease()).job!)

      const eligible = () =>
        runAs(
          tenant.userId,
          ownerTx((tx) =>
            ApplicationRepository.listOwnedByRunner(tx, {
              userId: tenant.userId,
              hhAccountId: tenant.accountId,
              limit: 10
            })
          )
        )
      // Пока блокировка стоит, заявка с капчей раннеру не отдаётся.
      expect((await eligible()).map((row) => row.id)).not.toContain(held)

      const result = await resume(ctx)
      expect(result.applicationIds).toEqual([held])
      const row = await runAs(
        "owner",
        ownerTx((tx) =>
          tx
            .execute(sql`select id, blocked_reason, retry_at from application where id in (${held}, ${other})`)
            .pipe(Effect.map((r) => r.rows as ReadonlyArray<{ id: string; blocked_reason: string | null; retry_at: Date | null }>))
        )
      )
      expect(row.find((r) => r.id === held)).toMatchObject({ blocked_reason: null, retry_at: null })
      expect(row.find((r) => r.id === other)!.blocked_reason).toBe("daily_cap")
      expect((await eligible()).map((r) => r.id)).toContain(held)
    })
  })

  describe("hourly limit", () => {
    const hourly = async (tenant: Awaited<ReturnType<typeof seedTenant>>, limit: number | null) =>
      runAs(
        tenant.userId,
        Effect.gen(function*() {
          const settings = yield* SettingsService
          return yield* settings.update({
            accountBrowserConcurrency: 6,
            accountActingConcurrency: 5,
            submitIntervalSeconds: 0,
            submitJitterPercent: 0,
            submitHourlyLimit: limit,
            harnessSlots: 6,
            formReadConcurrency: 2,
            formReadIntervalSeconds: 4,
            formReadJitterPercent: 100,
            formReadBlockedFactor: 3
          })
        })
      )

    test("no more submits than the limit within a rolling hour, per account; reads and other stages are not counted", async () => {
      const tenant = await seedTenant("hourly")
      await hourly(tenant, 2)
      for (let i = 0; i < 4; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: -1 })
      const holder = holderName()
      const claim = () => claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 6, actingConcurrency: 5 })

      expect((await claim())?.job.stage).toBe("submit")
      expect((await claim())?.job.stage).toBe("submit")
      // Третий submit ждёт, чтение за ним идёт.
      expect((await claim())?.job.stage).toBe("form_read")
      expect(await claim()).toBeNull()

      // Час прошёл: слоты освободились.
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`update harness_jobs set leased_at = now() - interval '61 minutes' where hh_account_id = ${tenant.accountId} and stage = 'submit'`)
        )
      )
      expect((await claim())?.job.stage).toBe("submit")

      // Лимит снят: оставшиеся уходят.
      await hourly(tenant, null)
      expect((await claim())?.job.stage).toBe("submit")
    })

    test("another account is counted on its own", async () => {
      const one = await seedTenant("hourly-a")
      const two = await seedTenant("hourly-b")
      await hourly(one, 1)
      await hourly(two, 1)
      for (const tenant of [one, two]) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      const holder = holderName()
      const claim = (accountId: string) => claimAsHolder({ holder, accounts: [accountId], actingConcurrency: 5, browserConcurrency: 6 })
      expect(await claim(one.accountId)).not.toBeNull()
      expect(await claim(one.accountId)).toBeNull()
      expect(await claim(two.accountId)).not.toBeNull()
    })
  })

  describe("settings in the database", () => {
    const update = (userId: string, patch: Partial<UserSettings>) =>
      runAs(
        userId,
        Effect.gen(function*() {
          const settings = yield* SettingsService
          const current = (yield* settings.get()).settings
          return yield* settings.update({ ...current, ...patch })
        })
      )

    test("form reads are paced per account and slow down while a captcha blocks it", async () => {
      const tenant = await seedTenant("form-read-pacing")
      await update(tenant.userId, {
        accountBrowserConcurrency: 6,
        formReadConcurrency: 5,
        formReadIntervalSeconds: 100,
        formReadJitterPercent: 0,
        formReadBlockedFactor: 3
      })
      for (let i = 0; i < 3; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      }
      const holder = holderName()
      const claim = () => claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 6, actingConcurrency: 5 })
      const nextIn = async () =>
        (
          (await runAs(
            "owner",
            ownerTx((tx) =>
              tx
                .execute(sql`select extract(epoch from (form_read_next_at - now()))::float as n from hh_account where id = ${tenant.accountId}`)
                .pipe(Effect.map((result) => (result.rows[0] as { n: number }).n))
            )
          )) as number
        )
      expect(await claim()).not.toBeNull()
      const first = await nextIn()
      expect(first).toBeGreaterThan(95)
      expect(first).toBeLessThanOrEqual(100)
      // Вторая чтение того же аккаунта ждёт паузу.
      expect(await claim()).toBeNull()

      // Капча: пауза в 3 раза длиннее.
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`
            update hh_account
            set submit_blocked_at = now(), submit_block_reason = 'captcha', form_read_next_at = null
            where id = ${tenant.accountId}
          `)
        )
      )
      expect(await claim()).not.toBeNull()
      const slowed = await nextIn()
      expect(slowed).toBeGreaterThan(295)
      expect(slowed).toBeLessThanOrEqual(300)
    })

    test("without a row the defaults from the environment apply and the view says nothing is stored", async () => {
      const tenant = await seedTenant("settings-default")
      const view = await runAs(tenant.userId, Effect.gen(function*() { return yield* (yield* SettingsService).get() }))
      expect(view.stored).toBe(false)
      expect(view.settings).toEqual(view.defaults)
      expect(view.defaults).toMatchObject({
        accountBrowserConcurrency: 4,
        accountActingConcurrency: 1,
        submitJitterPercent: 50,
        submitHourlyLimit: null,
        harnessSlots: 6
      })
    })

    test("a saved row changes claim behaviour at once, without restarting anything", async () => {
      const tenant = await seedTenant("settings-claim")
      for (let i = 0; i < 4; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      }
      for (let i = 0; i < 3; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      const holder = holderName()
      // Без строки потолки из аргументов claim: 1 браузерная задача разом.
      const claim = () => claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 1, actingConcurrency: 1 })
      expect(await claim()).not.toBeNull()
      expect(await claim()).toBeNull()

      // Строка поднимает потолок: следующий claim видит её сразу.
      await update(tenant.userId, {
        accountBrowserConcurrency: 3,
        accountActingConcurrency: 2,
        submitIntervalSeconds: 0
      })
      expect(await claim()).not.toBeNull()
      expect(await claim()).not.toBeNull()
      expect(await claim()).toBeNull()

      // И обратно: потолок ниже уже занятого не выдаёт ничего.
      await update(tenant.userId, { accountBrowserConcurrency: 1, accountActingConcurrency: 1 })
      expect(await claim()).toBeNull()
    })

    test("the interval and jitter come from the row", async () => {
      const tenant = await seedTenant("settings-pace")
      await update(tenant.userId, {
        accountBrowserConcurrency: 6,
        accountActingConcurrency: 5,
        submitIntervalSeconds: 100,
        submitJitterPercent: 0
      })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      const holder = holderName()
      const claim = () => claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 6, actingConcurrency: 5 })
      expect(await claim()).not.toBeNull()
      const next = (await pacingOf(tenant.accountId)).next_in!
      expect(next).toBeGreaterThan(95)
      expect(next).toBeLessThanOrEqual(100)
      expect(await claim()).toBeNull()
    })

    test("settings are per user", async () => {
      const one = await seedTenant("settings-a")
      const two = await seedTenant("settings-b")
      await update(one.userId, { harnessSlots: 2 })
      const view = await runAs(two.userId, Effect.gen(function*() { return yield* (yield* SettingsService).get() }))
      expect(view.stored).toBe(false)
      expect(view.settings.harnessSlots).toBe(6)
    })

    test("values outside the ranges, or more acting than browser jobs, are refused", async () => {
      const tenant = await seedTenant("settings-invalid")
      const failure = (patch: Partial<UserSettings>) =>
        runAsFailure(
          tenant.userId,
          Effect.gen(function*() {
            const settings = yield* SettingsService
            const current = (yield* settings.get()).settings
            return yield* settings.update({ ...current, ...patch })
          })
        )
      expect((await failure({ harnessSlots: 13 }))._tag).toBe("InvalidInput")
      expect((await failure({ submitHourlyLimit: 0 }))._tag).toBe("InvalidInput")
      expect((await failure({ accountBrowserConcurrency: 2, accountActingConcurrency: 3 }))._tag).toBe("InvalidInput")
    })

    test("the lease answer carries the harness slot count and follows the setting", async () => {
      const tenant = await seedTenant("settings-lease")
      const harness = await registerHarness(tenant.userId, [tenant.accountId])
      const lease = () => leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      expect((await lease()).harnessSlots).toBe(6)
      await update(tenant.userId, { harnessSlots: 3 })
      expect((await lease()).harnessSlots).toBe(3)
    })

    test("the concurrency view reports the stored values", async () => {
      const tenant = await seedTenant("settings-view")
      await update(tenant.userId, { accountBrowserConcurrency: 5, submitHourlyLimit: 40, harnessSlots: 8 })
      const view = await runAs(tenant.userId, Effect.gen(function*() { return yield* (yield* QueueService).concurrency() }))
      expect(view).toMatchObject({ browserCap: 5, submitHourlyLimit: 40, harnessSlots: 8 })
    })
  })
}
