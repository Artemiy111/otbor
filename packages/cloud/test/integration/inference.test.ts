/** Integration: inference. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import { Database } from "../../src/db/Database.ts"
import { harnessJob } from "../../src/db/tables.ts"
import {
  addAccount,
  completeJob,
  createTestDatabase,
  dropTestDatabase,
  enqueueInference,
  findJob,
  getInference,
  getInferenceFailure,
  insertRawJob,
  insertRawJobFailure,
  integrationEnabled,
  jobAccountId,
  leaseNext,
  makeJobRunnable,
  migrateTestDatabase,
  registerHarness,
  runAs,
  seedTenant,
  serverUrl,
  setDefaultAccount,
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

  describe("inference", () => {
    test("enqueue creates an inference job and attaches the default account", async () => {
      const tenant = await seedTenant("inference-enqueue")
      // A second account is newer but not the default, so the service must
      // prefer `is_default` over insertion order.
      const second = await addAccount(tenant.userId, "inference-enqueue-second")
      await setDefaultAccount(tenant.userId, tenant.accountId)

      const prompt = `Write a cover letter ${randomUUID()}`
      const { job } = await enqueueInference(tenant.userId, {
        prompt,
        system: "You are a Russian career assistant",
        model: "opencode/big-pickle"
      })

      expect(job.kind).toBe("inference")
      expect(job.stage).toBe("inference")
      expect(job.status).toBe("pending")
      expect(job.maxAttempts).toBe(3)
      expect(job.payload).toEqual({
        prompt,
        system: "You are a Russian career assistant",
        model: "opencode/big-pickle"
      })
      // No account was supplied, so the user's default account is attached.
      expect(await jobAccountId(job.id)).toBe(tenant.accountId)
      expect(await jobAccountId(job.id)).not.toBe(second)

      const fetched = await getInference(tenant.userId, job.id)
      expect(fetched.payload).toEqual(job.payload)
    })

    test("an inference harness leases, completes and the artifacts round-trip", async () => {
      const tenant = await seedTenant("inference-run")
      const { job } = await enqueueInference(tenant.userId, {
        prompt: "Rate this vacancy",
        model: "opencode/big-pickle"
      })
      const h = await registerHarness(
        tenant.userId,
        [tenant.accountId],
        "inference-harness",
        ["inference"]
      )

      const leased = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId], [
        "inference"
      ])
      expect(leased.job?.id).toBe(job.id)
      expect(leased.job?.kind).toBe("inference")
      expect(leased.job?.stage).toBe("inference")

      const artifacts = {
        text: "Strong match",
        model: "opencode/big-pickle",
        usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.002 },
        durationMs: 1_500
      }

      const done = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: leased.job!.leaseId!,
        epoch: leased.job!.leaseEpoch,
        exit: { tag: "prepared", artifacts }
      })
      expect(done.accepted).toBe(true)
      expect(done.status).toBe("done")

      const stored = await findJob(job.id)
      expect(stored?.status).toBe("done")
      expect(stored?.result).toEqual(artifacts)

      const fetched = await getInference(tenant.userId, job.id)
      expect(fetched.id).toBe(job.id)
      expect(fetched.kind).toBe("inference")
      expect(fetched.result).toEqual(artifacts)
    })

    test("inference_failed retries while attempts remain, then goes dead", async () => {
      const tenant = await seedTenant("inference-retry")
      const { job } = await enqueueInference(tenant.userId, { prompt: "retry me" })
      const h = await registerHarness(
        tenant.userId,
        [tenant.accountId],
        "inference-retry-harness",
        ["inference"]
      )

      const failOnce = async () => {
        const leased = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId], [
          "inference"
        ])
        expect(leased.job?.id).toBe(job.id)
        return completeJob(tenant.userId, {
          harnessId: h.id,
          token: h.token!,
          jobId: job.id,
          leaseId: leased.job!.leaseId!,
          epoch: leased.job!.leaseEpoch,
          exit: { tag: "inference_failed", message: "agent exited 1" }
        })
      }

      const first = await failOnce()
      expect(first.status).toBe("pending")
      const retried = (await findJob(job.id))!
      expect(retried.status).toBe("pending")
      expect(retried.attempts).toBe(1)
      // The retry is delayed; make it runnable instead of sleeping.
      expect(new Date(retried.runAt).getTime()).toBeGreaterThan(Date.now())

      await makeJobRunnable(job.id)
      const second = await failOnce()
      expect(second.status).toBe("pending")
      expect((await findJob(job.id))?.attempts).toBe(2)

      await makeJobRunnable(job.id)
      const third = await failOnce()
      expect(third.status).toBe("dead")
      expect((await findJob(job.id))?.status).toBe("dead")
      expect((await findJob(job.id))?.attempts).toBe(3)
    })

    test("another user cannot read the inference job through RLS or InferenceGet", async () => {
      const a = await seedTenant("inference-rls-a")
      const b = await seedTenant("inference-rls-b")
      const { job } = await enqueueInference(b.userId, { prompt: "private prompt" })

      const error = await getInferenceFailure(a.userId, job.id)
      expect(error._tag).toBe("NotFound")

      const visible = await runAs(
        a.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(a.userId, (tx) =>
            tx.select({ id: harnessJob.id }).from(harnessJob).where(eq(harnessJob.id, job.id))
          )
        })
      )
      expect(visible).toHaveLength(0)

      // B still sees it, so the empty result is RLS rather than an empty table.
      const visibleToB = await runAs(
        b.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(b.userId, (tx) =>
            tx.select({ id: harnessJob.id }).from(harnessJob).where(eq(harnessJob.id, job.id))
          )
        })
      )
      expect(visibleToB).toHaveLength(1)
      expect((await getInference(b.userId, job.id)).id).toBe(job.id)
    })

    test("migration 0006 accepts the inference stage and round-trips result", async () => {
      const tenant = await seedTenant("inference-migration")
      const result = {
        text: "round-trip",
        model: null,
        usage: { totalTokens: 12 },
        durationMs: 7
      }

      const id = await insertRawJob({
        userId: tenant.userId,
        stage: "inference",
        kind: "inference",
        result
      })

      const stored = await findJob(id)
      expect(stored?.stage).toBe("inference")
      expect(stored?.result).toEqual(result)

      // The recreated stage check still rejects a stage it does not know.
      const rejected = await insertRawJobFailure({
        userId: tenant.userId,
        stage: "not_a_stage"
      })
      // The Postgres constraint name survives inside the driver's cause chain.
      const reason = String((rejected as unknown as { cause?: unknown }).cause)
      expect(reason).toContain("harness_jobs_stage_check")
    })
  })
}
