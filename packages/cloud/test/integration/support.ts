import { randomUUID } from "node:crypto"
import type { HarnessExit, JobKind, JobStage, KitRecord, UserId } from "@otbor/contract"
import { PgClient } from "@effect/sql-pg"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, Logger, Redacted } from "effect"
import { Database, type DatabaseError, type Executor } from "../../src/db/Database.ts"
import { runMigrations } from "../../src/db/migrate.ts"
import {
  accountLease,
  application,
  harnessJob,
  hhAccount,
  users,
  vacancy
} from "../../src/db/tables.ts"
import * as ApplicationRepository from "../../src/repositories/ApplicationRepository.ts"
import * as HarnessRepository from "../../src/repositories/HarnessRepository.ts"
import * as QueueRepository from "../../src/repositories/QueueRepository.ts"
import { CurrentUser } from "../../src/services/CurrentUser.ts"
import { submitJob } from "../../src/services/jobs.ts"
import { QueueService } from "../../src/services/QueueService.ts"

/* -------------------------------------------------------------------------- */
/* Opt-in database lifecycle                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The integration suite is opt-in. `OTBOR_TEST_DATABASE_URL` is a connection
 * string to the *server*: its database name is ignored, and every run creates
 * its own `otbor_it_<pid>_<random>` database. Nothing is ever written to the
 * database named in the URL, so pointing it at `otbor` cannot damage the demo
 * corpus. `bun run test:integration` supplies the local Docker default.
 */
export const serverUrl = process.env.OTBOR_TEST_DATABASE_URL ?? null

export const integrationEnabled = serverUrl !== null && serverUrl !== ""

const databaseName = `otbor_it_${process.pid}_${randomUUID().slice(0, 8)}`

const urlFor = (base: string, database: string): string => {
  const parsed = new URL(base)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

/** Maintenance connection: always the `postgres` database, never the demo one. */
const maintenanceUrl = (base: string): string => urlFor(base, "postgres")

export const testDatabaseUrl = (base: string): string => urlFor(base, databaseName)

const quoteIdentifier = (name: string): string => {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`unsafe database identifier: ${name}`)
  }
  return `"${name}"`
}

const adminLayer = (base: string) =>
  PgClient.layer({ url: Redacted.make(maintenanceUrl(base)) })

const quiet = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([])))

const withAdmin = <A, E>(base: string, effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(quiet(effect.pipe(Effect.provide(adminLayer(base)))))

/** Creates the run's database. A stale leftover from a crashed run is dropped. */
export const createTestDatabase = (base: string): Promise<void> =>
  withAdmin(
    base,
    Effect.gen(function*() {
      const sqlClient = yield* PgClient.PgClient
      const name = quoteIdentifier(databaseName)
      yield* sqlClient.unsafe(`drop database if exists ${name}`)
      yield* sqlClient.unsafe(`create database ${name}`)
    })
  )

/** Applies the hand-written migrations through the real migrator. */
export const migrateTestDatabase = (base: string): Promise<void> =>
  Effect.runPromise(
    quiet(
      runMigrations().pipe(
        Effect.provide(PgClient.layer({ url: Redacted.make(testDatabaseUrl(base)) }))
      )
    )
  ).then(() => undefined)

/** Terminates leftovers and drops the run's database. */
export const dropTestDatabase = (base: string): Promise<void> =>
  withAdmin(
    base,
    Effect.gen(function*() {
      const sqlClient = yield* PgClient.PgClient
      // A crashed run can leave a pool open; terminate it before dropping.
      yield* sqlClient.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where datname = '${databaseName}' and pid <> pg_backend_pid()`
      )
      yield* sqlClient.unsafe(`drop database if exists ${quoteIdentifier(databaseName)}`)
    })
  )

/* -------------------------------------------------------------------------- */
/* Layers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A request layer for an explicit user. Both the owner pool and the
 * `otbor_runtime` transaction role come from the real `Database.layer`; only
 * `CurrentUser` is stubbed so tests can speak as A or B.
 */
export const layerFor = (userId: string) => {
  const shared = Layer.merge(
    Database.layer,
    Layer.succeed(CurrentUser, { userId: userId as UserId })
  )
  return Layer.merge(shared, QueueService.layer.pipe(Layer.provide(shared)))
}

type Requirements = Database | QueueService

export const runAs = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Requirements>
): Promise<A> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.provide(layerFor(userId))))
  )

/** Runs an effect expected to fail and returns the typed error. */
export const runAsFailure = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Requirements>
): Promise<E> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.flip, Effect.provide(layerFor(userId))))
  )

/* -------------------------------------------------------------------------- */
/* Seeds                                                                      */
/* -------------------------------------------------------------------------- */

const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`

const ownerTx = <A, E>(
  run: (tx: Executor) => Effect.Effect<A, E, never>
): Effect.Effect<A, E | DatabaseError, Database> =>
  Effect.gen(function*() {
    const database = yield* Database
    return yield* database.asOwner((tx) => run(tx))
  })

export interface Tenant {
  readonly userId: string
  readonly accountId: string
}

/** A user and one hh account, inserted as the owner so setup never fights RLS. */
export const seedTenant = async (label: string): Promise<Tenant> => {
  const userId = unique(`it-${label}`)
  const accountId = await runAs(
    userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        yield* tx.insert(users).values({ id: userId, name: label, email: `${userId}@test.local` })
        const [account] = yield* tx.insert(hhAccount).values({ userId, label }).returning()
        return account!.id
      })
    )
  )
  return { userId, accountId }
}

export const addAccount = async (userId: string, label: string): Promise<string> => {
  const accountId = await runAs(
    userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [account] = yield* tx.insert(hhAccount).values({ userId, label }).returning()
        return account!.id
      })
    )
  )
  return accountId
}

export const seedVacancy = async (label: string): Promise<string> => {
  const externalId = unique(`v-${label}`)
  return runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(vacancy)
          .values({
            source: "hh",
            externalId,
            canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
            title: `Integration vacancy ${label}`,
            contentHash: randomUUID()
          })
          .returning()
        return row!.id
      })
    )
  )
}

export const seedApplication = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly vacancyId: string
  readonly state?: "draft" | "queued"
}): Promise<string> =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(application)
          .values({
            userId: input.userId,
            hhAccountId: input.accountId,
            vacancyId: input.vacancyId,
            state: input.state ?? "queued"
          })
          .returning({ id: application.id })
        return row!.id
      })
    )
  )

export const seedKit = async (input: {
  readonly userId: string
  readonly applicationId: string
}) => {
  return runAs(
    input.userId,
    ownerTx((tx) =>
      ApplicationRepository.upsertKit(tx, {
        userId: input.userId,
        applicationId: input.applicationId,
        formHash: unique("form"),
        letter: "integration test",
        answers: [],
        model: null,
        promptHash: null,
        costUsd: null
      })
    )
  )
}

export const enqueueJob = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly applicationId?: string | null
  readonly stage: JobStage
  readonly kind?: JobKind
  readonly payload?: Record<string, unknown>
  readonly priority?: number
  readonly maxAttempts?: number
  readonly runAt?: Date
  readonly idempotencyKey?: string
}) =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      QueueRepository.enqueue(tx, {
        userId: input.userId,
        hhAccountId: input.accountId,
        applicationId: input.applicationId ?? null,
        stage: input.stage,
        kind: input.kind ?? "browser",
        payload: input.payload ?? {},
        priority: input.priority,
        maxAttempts: input.maxAttempts,
        runAt: input.runAt,
        idempotencyKey: input.idempotencyKey ?? unique(`it-${input.stage}`)
      })
    )
  )

/** Enqueues through the real `submitJob`, whose key is constant per application. */
export const enqueueSubmitJob = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly applicationId: string
  readonly vacancyId: string
  readonly canonicalUrl: string
  readonly kit: KitRecord
  readonly resumeId?: string | null
}) =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      submitJob(tx, {
        userId: input.userId,
        hhAccountId: input.accountId,
        applicationId: input.applicationId,
        vacancyId: input.vacancyId,
        canonicalUrl: input.canonicalUrl,
        kit: input.kit,
        resumeId: input.resumeId ?? null
      })
    )
  )

/* -------------------------------------------------------------------------- */
/* Service calls                                                              */
/* -------------------------------------------------------------------------- */

export const registerHarness = async (
  userId: string,
  accounts: ReadonlyArray<string>,
  name = unique("harness")
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.register({ name, kinds: ["browser"], accounts })
    })
  )

export const leaseNext = async (
  userId: string,
  harnessId: string,
  token: string,
  accounts: ReadonlyArray<string>
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.leaseNext({ harnessId, token, kinds: ["browser"], accounts })
    })
  )

export const heartbeatJob = async (
  userId: string,
  input: { harnessId: string; token: string; jobId: string; leaseId: string; epoch: number }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.heartbeat(input)
    })
  )

export const completeJob = async (
  userId: string,
  input: {
    harnessId: string
    token: string
    jobId: string
    leaseId: string
    epoch: number
    exit: HarnessExit
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.complete(input)
    })
  )

export const completeJobFailure = async (
  userId: string,
  input: {
    harnessId: string
    token: string
    jobId: string
    leaseId: string
    epoch: number
    exit: HarnessExit
  }
) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.complete(input)
    })
  )

/* -------------------------------------------------------------------------- */
/* Owner reads and writes used by assertions                                  */
/* -------------------------------------------------------------------------- */

export const findJob = async (jobId: string) =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.findById(tx, jobId))
  )

export const countJobs = async (applicationId: string, stage: JobStage) =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.countFor(tx, applicationId, stage))
  )

export const findApplication = async (applicationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: application.id,
          state: application.state,
          submittedAt: application.submittedAt
        })
        .from(application)
        .where(eq(application.id, applicationId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const accountsFor = async (harnessId: string) =>
  runAs(
    "owner",
    ownerTx((tx) => HarnessRepository.accountsFor(tx, harnessId))
  )

export const harnessAccountRows = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .execute(
          sql`select harness_id, user_id from harness_account where hh_account_id = ${accountId}`
        )
        .pipe(Effect.map((result) => result.rows))
    )
  )

/** Expires a job lease without waiting, so recovery can be tested quickly. */
export const expireJobLease = async (jobId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(
        sql`update harness_jobs set lease_until = now() - interval '1 minute' where id = ${jobId}`
      )
    )
  )
}

export const recoverExpiredJobs = async () =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.recoverExpired(tx))
  )

export const makeJobRunnable = async (jobId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(sql`update harness_jobs set run_at = now() where id = ${jobId}`)
    )
  )
}

export const expireAccountLease = async (accountId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(
        sql`update account_lease set expires_at = now() - interval '1 minute' where hh_account_id = ${accountId}`
      )
    )
  )
}

export const findAccountLease = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(accountLease)
        .where(eq(accountLease.hhAccountId, accountId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const claimAsHolder = async (input: {
  readonly holder: string
  readonly accounts: ReadonlyArray<string>
  readonly kinds?: ReadonlyArray<JobKind>
  readonly leaseSeconds?: number
}) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      QueueRepository.claim(tx, {
        holder: input.holder,
        accounts: input.accounts,
        kinds: input.kinds ?? ["browser"],
        leaseSeconds: input.leaseSeconds
      })
    )
  )

export const jobRowsForApplication = async (applicationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: harnessJob.id,
          stage: harnessJob.stage,
          status: harnessJob.status,
          runAt: harnessJob.runAt
        })
        .from(harnessJob)
        .where(eq(harnessJob.applicationId, applicationId))
    )
  )
