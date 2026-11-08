import { SQL } from "bun"
import { afterAll, describe, expect, test } from "bun:test"
import type { HarnessJob } from "@otbor/contract"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Logger } from "effect"
import { generateHarnessToken, hashHarnessToken } from "../src/auth/harnessToken.ts"
import { Database, type Executor } from "../src/db/Database.ts"
import { migrateProgram } from "../src/db/migrate.ts"
import { harness } from "../src/db/tables.ts"
import * as QueueRepository from "../src/repositories/QueueRepository.ts"
import { ensureBootstrapUser } from "../src/services/bootstrap.ts"
import { CurrentUser } from "../src/services/CurrentUser.ts"
import { QueueService } from "../src/services/QueueService.ts"

/* -------------------------------------------------------------------------- */
/* A throwaway database, so the suite never touches the operator's corpus     */
/* -------------------------------------------------------------------------- */

interface TestDatabase {
  readonly url: string
  readonly close: () => Promise<void>
}

const adminUrl = (): string =>
  process.env.OTBOR_TEST_ADMIN_URL ??
  process.env.DATABASE_URL ??
  "postgres://otbor:otbor@localhost:55432/postgres"

/**
 * Адрес своей базы передаётся слою явно, а не через `process.env`: в общем
 * прогоне `bun test` интеграционные файлы того же процесса переписывают
 * `DATABASE_URL`, и тест уходил в чужую базу.
 */
const databaseUrlLayer = (url: string) =>
  ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ DATABASE_URL: url }), { asPrimary: true })

const createTestDatabase = async (): Promise<TestDatabase | null> => {
  const base = adminUrl()
  const name = `otbor_harness_auth_${process.pid}_${Date.now()}`

  const admin = new SQL(base)
  try {
    await admin.unsafe("select 1")
    await admin.unsafe(`create database "${name}"`)
  } catch {
    await admin.close()
    return null
  }
  await admin.close()

  const url = new URL(base)
  url.pathname = `/${name}`
  const connection = url.toString()

  try {
    await Effect.runPromise(
      migrateProgram().pipe(Effect.provide(Logger.layer([])), Effect.provide(databaseUrlLayer(connection)))
    )
  } catch (cause) {
    const cleanup = new SQL(base)
    await cleanup.unsafe(`drop database if exists "${name}" with (force)`)
    await cleanup.close()
    throw cause
  }

  return {
    url: connection,
    close: async () => {
      const cleanup = new SQL(base)
      await cleanup.unsafe(`drop database if exists "${name}" with (force)`)
      await cleanup.close()
    }
  }
}

const database = await createTestDatabase()

afterAll(async () => {
  await database?.close()
})

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const withQueue = <A, E>(effect: Effect.Effect<A, E, QueueService>) =>
  Effect.gen(function*() {
    yield* ensureBootstrapUser
    return yield* effect
  }).pipe(
    Effect.provide(QueueService.layer),
    Effect.provide(Layer.mergeAll(Database.layer, CurrentUser.layer)),
    Effect.provide(Logger.layer([])),
    Effect.provide(databaseUrlLayer(database!.url))
  )

const runQueue = <A, E>(effect: Effect.Effect<A, E, QueueService>) =>
  Effect.runPromise(withQueue(effect))

const runDb = <A, E>(effect: (tx: Executor) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const db = yield* Database
      return yield* db.asOwner(effect)
    }).pipe(
      Effect.provide(Database.layer),
      Effect.provide(Logger.layer([])),
      Effect.provide(databaseUrlLayer(database!.url))
    )
  )

const registerHarness = (name: string) =>
  runQueue(
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.register({ name, kinds: [], accounts: [] })
    })
  )

const lease = (harnessId: string, token: string) =>
  runQueue(
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.leaseNext({
        harnessId,
        token,
        kinds: [],
        accounts: [],
        waitSeconds: 0
      })
    })
  )

const enqueueSessionJob = (key: string) =>
  runDb((tx) =>
    QueueRepository.enqueue(tx, {
      userId: "local-user",
      hhAccountId: null,
      applicationId: null,
      stage: "session",
      kind: "browser",
      payload: {},
      idempotencyKey: key
    })
  )

const storedHarness = async (harnessId: string) => {
  const rows = await runDb((tx) =>
    tx
      .select({ tokenHash: harness.tokenHash })
      .from(harness)
      .where(eq(harness.id, harnessId))
  )
  return rows[0]
}

/** Runs an operation that must fail and returns its typed error tag. */
const rejected = async (
  program: Promise<unknown> | Effect.Effect<unknown, unknown, QueueService>
) => {
  try {
    await (program instanceof Promise ? program : runQueue(program))
    return "no error"
  } catch (error) {
    return (error as { readonly _tag?: string })._tag ?? String(error)
  }
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

const maybeTest = (name: string, fn: () => Promise<void>) =>
  test.skipIf(database === null)(name, fn, 30_000)

describe("harness device-token authentication", () => {
  maybeTest("register returns the token once and stores only its SHA-256 hash", async () => {
    const registration = await registerHarness("hash-only")

    expect(registration.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const row = await storedHarness(registration.id)
    expect(row?.tokenHash).toBe(hashHarnessToken(registration.token!))
    expect(row?.tokenHash).not.toBe(registration.token)
  })

  maybeTest("a valid token leases, heartbeats and completes a job", async () => {
    const registration = await registerHarness("valid-flow")
    await enqueueSessionJob(`valid-flow-${registration.id}`)

    const leased = await lease(registration.id, registration.token!)
    expect(leased.job).not.toBeNull()
    const job = leased.job as HarnessJob

    const heartbeat = await runQueue(
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.heartbeat({
          harnessId: registration.id,
          token: registration.token!,
          jobId: job.id,
          leaseId: job.leaseId!,
          epoch: job.leaseEpoch
        })
      })
    )
    expect(heartbeat.ok).toBe(true)

    const completed = await runQueue(
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.complete({
          harnessId: registration.id,
          token: registration.token!,
          jobId: job.id,
          leaseId: job.leaseId!,
          epoch: job.leaseEpoch,
          exit: { tag: "prepared" }
        })
      })
    )
    expect(completed.accepted).toBe(true)
    expect(completed.status).toBe("done")
  })

  maybeTest("missing and wrong tokens are rejected on every operation", async () => {
    const registration = await registerHarness("bad-token")
    const other = await registerHarness("other-device")

    expect(await rejected(lease(registration.id, ""))).toBe("HarnessRejected")
    expect(await rejected(lease(registration.id, generateHarnessToken()))).toBe("HarnessRejected")
    // A valid token for one harness does not authenticate another harness id.
    expect(await rejected(lease(other.id, registration.token!))).toBe("HarnessRejected")

    const jobId = "00000000-0000-0000-0000-000000000000" as HarnessJob["id"]
    const leaseId = "00000000-0000-0000-0000-000000000000" as NonNullable<HarnessJob["leaseId"]>

    expect(
      await rejected(
        Effect.gen(function*() {
          const queue = yield* QueueService
          return yield* queue.heartbeat({
            harnessId: registration.id,
            token: "",
            jobId,
            leaseId,
            epoch: 1
          })
        })
      )
    ).toBe("HarnessRejected")

    expect(
      await rejected(
        Effect.gen(function*() {
          const queue = yield* QueueService
          return yield* queue.complete({
            harnessId: registration.id,
            token: generateHarnessToken(),
            jobId,
            leaseId,
            epoch: 1,
            exit: { tag: "prepared" }
          })
        })
      )
    ).toBe("HarnessRejected")
  })

  maybeTest("revoke clears the hash and the old token can no longer lease", async () => {
    const registration = await registerHarness("revoked")
    const token = registration.token!

    const result = await runQueue(
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.revoke({ harnessId: registration.id })
      })
    )
    expect(result.revoked).toBe(true)
    expect((await storedHarness(registration.id))?.tokenHash).toBeNull()

    expect(await rejected(lease(registration.id, token))).toBe("HarnessRejected")
  })

  maybeTest("re-registering rotates the token and keeps the same harness id", async () => {
    const first = await registerHarness("rotate")
    const second = await registerHarness("rotate")

    expect(second.id).toBe(first.id)
    expect(second.token).not.toBe(first.token)
    expect(await rejected(lease(first.id, first.token!))).toBe("HarnessRejected")

    const leased = await lease(second.id, second.token!)
    expect(leased.job).toBeNull()
  })
})
