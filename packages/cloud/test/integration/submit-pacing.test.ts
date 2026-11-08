/**
 * Темп отправок и пауза после капчи, по аккаунту hh: claim не выдаёт
 * действующую задачу раньше `submit_next_at` и во время `submit_paused_until`,
 * читающие задачи не затронуты. Время двигается правкой сохранённых моментов.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
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
  seedTenant,
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
                   extract(epoch from (submit_paused_until - now()))::float as paused_in,
                   submit_pause_reason as reason
            from hh_account where id = ${accountId}
          `)
          .pipe(Effect.map((result) => result.rows[0] as { next_in: number | null; paused_in: number | null; reason: string | null }))
      )
    )

  /** Сдвигает моменты темпа и паузы в прошлое: «прошло достаточно времени». */
  const elapse = (accountId: string) =>
    runAs(
      "owner",
      ownerTx((tx) =>
        tx.execute(sql`
          update hh_account
          set submit_next_at = submit_next_at - interval '1 hour',
              submit_paused_until = submit_paused_until - interval '1 hour'
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

  describe("captcha pause", () => {
    /** Submit без доказательств: захваченный, он завершается капчей. */
    const leaseSubmit = async (tenant: Awaited<ReturnType<typeof seedTenant>>) => {
      const harness = await registerHarness(tenant.userId, [tenant.accountId])
      return { harness, lease: () => leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId]) }
    }

    test("a captcha on a job pauses the submits of the account for five minutes, reads continue", async () => {
      const tenant = await seedTenant("captcha")
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session", priority: 50 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit", priority: 40 })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 1 })
      const { harness, lease } = await leaseSubmit(tenant)

      const session = await lease()
      expect(session.job?.stage).toBe("session")
      const done = await completeJob(tenant.userId, {
        harnessId: harness.id,
        token: harness.token!,
        jobId: session.job!.id,
        leaseId: session.job!.leaseId!,
        epoch: session.job!.leaseEpoch,
        exit: { tag: "captcha", message: "hh asked for a captcha" }
      })
      expect(done.accepted).toBe(true)

      const paused = await pacingOf(tenant.accountId)
      expect(paused.reason).toBe("captcha")
      expect(paused.paused_in!).toBeGreaterThan(290)
      expect(paused.paused_in!).toBeLessThanOrEqual(300)

      // submit (приоритет выше) стоит, форма читается.
      expect((await lease()).job?.stage).toBe("form_read")
      expect((await lease()).job).toBeNull()

      // Вторая капча во время паузы её не продлевает.
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`update hh_account set submit_paused_until = now() + interval '100 seconds' where id = ${tenant.accountId}`)
        )
      )
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      const again = await lease()
      expect(again.job?.stage).toBe("session")
      await completeJob(tenant.userId, {
        harnessId: harness.id,
        token: harness.token!,
        jobId: again.job!.id,
        leaseId: again.job!.leaseId!,
        epoch: again.job!.leaseEpoch,
        exit: { tag: "captcha" }
      })
      expect((await pacingOf(tenant.accountId)).paused_in!).toBeLessThanOrEqual(100)

      // Пауза вышла: submit выдаётся.
      await elapse(tenant.accountId)
      expect((await lease()).job?.stage).toBe("submit")
    })
  })
}
