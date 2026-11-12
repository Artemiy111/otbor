/**
 * Предохранитель отправок: серия одинаковых детерминированных отказов submit
 * ставит аккаунт на паузу `repeated_failure`, как капча, только со своим
 * сроком и текстом отказа. Попытки идут настоящим путём: lease submit-задачи и
 * complete с ответом исполнителя.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import * as SubmitPacingRepository from "../../src/repositories/SubmitPacingRepository.ts"
import { resumeCaptchaBlocks } from "../../src/services/captchaAutoResume.ts"
import { HhAccountService } from "../../src/services/HhAccountService.ts"
import * as support from "./support/index.ts"

if (!support.integrationEnabled || support.serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(support.integrationEnabled).toBe(false)
  })
} else {
  const base = support.serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await support.createTestDatabase(base)
    await support.migrateTestDatabase(base)
    process.env.DATABASE_URL = support.testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await support.dropTestDatabase(base)
  }, 60_000)

  const message = (resume = "DevOps-инженер", id = 291000851) =>
    `the resume "${resume}" (${id}) did not appear in hh's resume select`
  const unclicked = { clicked: false, url: "", marker: "none" }

  interface Ctx {
    readonly tenant: support.Tenant
    readonly harness: { id: string; token?: string | null }
  }

  const setup = async (label: string): Promise<Ctx> => {
    const tenant = await support.seedTenant(label)
    const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
    return { tenant, harness }
  }

  /** Одна попытка submit: новая заявка, lease, ответ исполнителя. Темп сбрасывается, чтобы не ждать. */
  const attempt = async (ctx: Ctx, exit: { tag: string; message?: string; artifacts?: Record<string, unknown> }) => {
    const vacancyId = await support.seedVacancy("rf")
    const applicationId = await support.seedApplication({
      userId: ctx.tenant.userId,
      accountId: ctx.tenant.accountId,
      vacancyId,
      state: "queued"
    })
    const kit = await support.seedKit({ userId: ctx.tenant.userId, applicationId })
    await support.enqueueSubmitJob({
      userId: ctx.tenant.userId,
      accountId: ctx.tenant.accountId,
      applicationId,
      vacancyId,
      canonicalUrl: `https://hh.ru/vacancy/integration-${randomUUID()}`,
      kit
    })
    await support.runAs(
      "owner",
      support.ownerTx((tx) => tx.execute(sql`update hh_account set submit_next_at = null where id = ${ctx.tenant.accountId}`))
    )
    const leased = await support.leaseNext(ctx.tenant.userId, ctx.harness.id, ctx.harness.token!, [ctx.tenant.accountId])
    expect(leased.job?.stage).toBe("submit")
    await support.completeJob(ctx.tenant.userId, {
      harnessId: ctx.harness.id,
      token: ctx.harness.token!,
      jobId: leased.job!.id,
      leaseId: leased.job!.leaseId!,
      epoch: leased.job!.leaseEpoch,
      exit: exit as never
    })
  }

  const blocked = (ctx: Ctx, text = message()) => attempt(ctx, { tag: "blocked", message: text, artifacts: unclicked })
  const success = (ctx: Ctx) =>
    attempt(ctx, {
      tag: "submitted",
      artifacts: {
        clicked: true,
        url: "https://hh.ru/applicant/vacancy_response?vacancyId=100500",
        marker: "success",
        html: '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'
      }
    })

  const pauseOf = (accountId: string) =>
    support.runAs(
      "owner",
      support.ownerTx((tx) =>
        tx
          .execute(sql`
            select submit_blocked_at as at, submit_block_reason as reason, submit_block_detail as detail,
                   extract(epoch from (submit_retry_at - now()))::float / 3600 as retry_hours
            from hh_account where id = ${accountId}
          `)
          .pipe(Effect.map((r) => r.rows[0] as { at: Date | null; reason: string | null; detail: string | null; retry_hours: number | null }))
      )
    )

  /** Срок паузы вышел: сдвигаем `submit_retry_at` в прошлое и запускаем автоснятие. */
  const autoResume = async (accountId: string) => {
    await support.runAs(
      "owner",
      support.ownerTx((tx) =>
        tx.execute(sql`update hh_account set submit_retry_at = now() - interval '1 minute' where id = ${accountId}`)
      )
    )
    return support.runAs("owner", resumeCaptchaBlocks())
  }

  const times = async (n: number, run: () => Promise<void>) => {
    for (let i = 0; i < n; i += 1) await run()
  }

  describe("repeated failure pause", () => {
    test("five identical blocked in a row pause the account with the original text", async () => {
      const ctx = await setup("rf-five")
      // Id вакансии и название резюме в тексте разные: нормализация их сравнивает как одно.
      for (let i = 0; i < 5; i += 1) await blocked(ctx, message(`Резюме ${i}`, 291000851 + i))
      const pause = await pauseOf(ctx.tenant.accountId)
      expect(pause.reason).toBe("repeated_failure")
      expect(pause.at).not.toBeNull()
      expect(pause.detail).toBe(message("Резюме 4", 291000855))
      expect(pause.retry_hours!).toBeGreaterThan(5.9)
      expect(pause.retry_hours!).toBeLessThanOrEqual(6)

      const block = await support.runAs(
        "owner",
        support.ownerTx((tx) => SubmitPacingRepository.activeBlock(tx, ctx.tenant.accountId))
      )
      expect(block?.reason).toBe("repeated_failure")
      const account = await support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* HhAccountService).findById(ctx.tenant.accountId)
        })
      )
      expect(account?.submitBlockReason).toBe("repeated_failure")
      expect(account?.submitBlockDetail).toBe(message("Резюме 4", 291000855))
    })

    test("four are not enough", async () => {
      const ctx = await setup("rf-four")
      await times(4, () => blocked(ctx))
      expect((await pauseOf(ctx.tenant.accountId)).at).toBeNull()
    })

    test("a success in the middle resets the series", async () => {
      const ctx = await setup("rf-success")
      await times(3, () => blocked(ctx))
      await success(ctx)
      await times(4, () => blocked(ctx))
      expect((await pauseOf(ctx.tenant.accountId)).at).toBeNull()
      await blocked(ctx)
      expect((await pauseOf(ctx.tenant.accountId)).reason).toBe("repeated_failure")
    })

    test("different messages do not add up", async () => {
      const ctx = await setup("rf-different")
      await times(4, () => blocked(ctx))
      await blocked(ctx, "the response page was not recognized")
      expect((await pauseOf(ctx.tenant.accountId)).at).toBeNull()
    })

    test("failures tied to the vacancy are not counted", async () => {
      const ctx = await setup("rf-vacancy")
      for (const tag of ["answer_rejected", "form_changed"]) {
        await times(6, () => attempt(ctx, { tag, message: "same text", artifacts: unclicked }))
      }
      expect((await pauseOf(ctx.tenant.accountId)).at).toBeNull()
    })

    test("the pause ends by itself and by hand, and the text is cleared", async () => {
      const ctx = await setup("rf-resume")
      await times(5, () => blocked(ctx))
      expect(await autoResume(ctx.tenant.accountId)).toContain(ctx.tenant.accountId)
      const after = await pauseOf(ctx.tenant.accountId)
      expect(after).toMatchObject({ at: null, reason: null, detail: null })

      // Вторая пауза: снимает оператор.
      await blocked(ctx)
      expect((await pauseOf(ctx.tenant.accountId)).reason).toBe("repeated_failure")
      await support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* HhAccountService).resumeSubmits(ctx.tenant.accountId)
        })
      )
      expect(await pauseOf(ctx.tenant.accountId)).toMatchObject({ at: null, reason: null, detail: null })
    })

    test("a repeat after the automatic resume pauses again with a doubled term, up to 24 hours", async () => {
      const ctx = await setup("rf-double")
      await times(5, () => blocked(ctx))
      expect((await pauseOf(ctx.tenant.accountId)).retry_hours!).toBeLessThanOrEqual(6)

      const expected = [12, 24, 24]
      for (const hours of expected) {
        await autoResume(ctx.tenant.accountId)
        await blocked(ctx)
        const pause = await pauseOf(ctx.tenant.accountId)
        expect(pause.reason).toBe("repeated_failure")
        expect(pause.retry_hours!).toBeGreaterThan(hours - 0.1)
        expect(pause.retry_hours!).toBeLessThanOrEqual(hours)
      }
    })

    test("claim does not give a submit of a paused account; the other account is untouched", async () => {
      const ctx = await setup("rf-claim")
      const other = await setup("rf-claim-other")
      await times(5, () => blocked(ctx))
      for (const tenant of [ctx.tenant, other.tenant]) {
        await support.enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      }
      // Держатель - зарегистрированный исполнитель: аккаунт уже за ним (account_lease), чужому claim не выдаст.
      const claim = (c: Ctx) => support.claimAsHolder({ holder: c.harness.id, accounts: [c.tenant.accountId] })
      expect(await claim(ctx)).toBeNull()
      expect((await claim(other))?.job.stage).toBe("submit")
      expect((await pauseOf(other.tenant.accountId)).at).toBeNull()

      // После снятия паузы submit выдаётся.
      await autoResume(ctx.tenant.accountId)
      expect((await claim(ctx))?.job.stage).toBe("submit")
    })

    test("failures of one account do not count for another", async () => {
      const one = await setup("rf-iso-a")
      const two = await setup("rf-iso-b")
      await times(3, () => blocked(one))
      await times(3, () => blocked(two))
      expect((await pauseOf(one.tenant.accountId)).at).toBeNull()
      expect((await pauseOf(two.tenant.accountId)).at).toBeNull()
    })
  })
}
