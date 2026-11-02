import { randomUUID } from "node:crypto"
import type {
  CrawlFinishStatus,
  HarnessExit,
  JobKind,
  JobStage,
  KitRecord,
  UserId,
  VacancyId
} from "@otbor/contract"
import { normalizeTerm } from "@otbor/domain"
import { PgClient } from "@effect/sql-pg"
import { asc, eq, sql } from "drizzle-orm"
import { Effect, Layer, Logger, Redacted } from "effect"
import { Database, type DatabaseError, type Executor } from "../../src/db/Database.ts"
import { runMigrations } from "../../src/db/migrate.ts"
import {
  accountLease,
  application,
  harnessJob,
  hhAccount,
  keyword,
  preset,
  schedule,
  searchQuery,
  searchRun,
  titleVerdict,
  users,
  vacancy,
  vacancyKeyword,
  vacancySearchHit
} from "../../src/db/tables.ts"
import * as ApplicationRepository from "../../src/repositories/ApplicationRepository.ts"
import * as HarnessRepository from "../../src/repositories/HarnessRepository.ts"
import * as PresetRepository from "../../src/repositories/PresetRepository.ts"
import * as QueueRepository from "../../src/repositories/QueueRepository.ts"
import * as ScheduleRepository from "../../src/repositories/ScheduleRepository.ts"
import { CorpusService } from "../../src/services/CorpusService.ts"
import { CrawlRunner, type CrawlRunnerResult } from "../../src/services/CrawlRunner.ts"
import { CrawlService, type CrawlSavePageInput } from "../../src/services/CrawlService.ts"
import { CurrentUser } from "../../src/services/CurrentUser.ts"
import { GateService, type GateServiceShape } from "../../src/services/GateService.ts"
import {
  InferenceService,
  type EnqueueInferenceInput
} from "../../src/services/InferenceService.ts"
import { PresetService } from "../../src/services/PresetService.ts"
import { submitJob } from "../../src/services/jobs.ts"
import { QueueService } from "../../src/services/QueueService.ts"
import {
  ScheduleService,
  type ScheduleUpsertInput
} from "../../src/services/ScheduleService.ts"
import { runDueSchedules } from "../../src/services/ScheduleWorker.ts"

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
 *
 * `runner` replaces the real hh crawler for schedule tests. Nothing in the
 * integration suite may fetch hh.ru.
 */
export const layerFor = (
  userId: string,
  runner?: Layer.Layer<CrawlRunner, never, never>
) => {
  const shared = Layer.merge(
    Database.layer,
    Layer.succeed(CurrentUser, { userId: userId as UserId })
  )
  const crawlServices = Layer.merge(CrawlService.layer, CorpusService.layer).pipe(
    Layer.provide(shared)
  )
  const crawlRunner =
    runner ?? CrawlRunner.layer.pipe(Layer.provide(Layer.merge(shared, crawlServices)))
  const crawlStack = Layer.mergeAll(crawlServices, crawlRunner)

  return Layer.mergeAll(
    shared,
    crawlStack,
    QueueService.layer.pipe(Layer.provide(shared)),
    InferenceService.layer.pipe(Layer.provide(shared)),
    GateService.layer.pipe(Layer.provide(shared)),
    PresetService.layer.pipe(Layer.provide(shared)),
    ScheduleService.layer.pipe(Layer.provide(Layer.merge(shared, crawlStack)))
  )
}

type Requirements =
  | Database
  | QueueService
  | InferenceService
  | CrawlService
  | GateService
  | PresetService
  | CorpusService
  | CrawlRunner
  | ScheduleService

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

/** Same as `runAs`, with a fake CrawlRunner instead of the hh crawler. */
export const runAsWithRunner = <A, E>(
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  effect: Effect.Effect<A, E, Requirements>
): Promise<A> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.provide(layerFor(userId, runner))))
  )

export const runAsWithRunnerFailure = <A, E>(
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  effect: Effect.Effect<A, E, Requirements>
): Promise<E> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.flip, Effect.provide(layerFor(userId, runner))))
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

/** Flips the user's default account without a service in between. */
export const setDefaultAccount = async (userId: string, accountId: string): Promise<void> => {
  await runAs(
    userId,
    ownerTx((tx) =>
      tx.execute(
        sql`update hh_account set is_default = (id = ${accountId}) where user_id = ${userId}`
      )
    )
  )
}

export const seedVacancyTitled = async (
  label: string,
  title: string,
  options: { readonly archived?: boolean } = {}
): Promise<string> => {
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
            title,
            archived: options.archived ?? false,
            contentHash: randomUUID()
          })
          .returning()
        return row!.id
      })
    )
  )
}

export const seedVacancy = async (label: string): Promise<string> =>
  seedVacancyTitled(label, `Integration vacancy ${label}`)

export const seedKeyword = async (term: string): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(keyword)
          .values({ term, normalizedTerm: normalizeTerm(term) })
          .returning({ id: keyword.id })
        return row!.id
      })
    )
  )

export const seedVacancyKeyword = async (input: {
  readonly vacancyId: string
  readonly keywordId: string
  readonly matchedForm: string
}): Promise<void> => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.insert(vacancyKeyword).values({
        vacancyId: input.vacancyId,
        keywordId: input.keywordId,
        matchedForm: normalizeTerm(input.matchedForm)
      })
    )
  )
}

/** Mirrors the normalized title `title_verdict` is keyed by. */
export const normalizedTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, " ")

export const seedTitleVerdict = async (
  title: string,
  verdict: "match" | "unknown" | "reject"
): Promise<void> => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.insert(titleVerdict).values({
        normalizedTitle: normalizedTitle(title),
        verdict,
        source: "rules",
        rulesVersion: 1
      })
    )
  )
}

export const seedPreset = async (
  userId: string,
  input: {
    readonly kind?: "explore" | "apply"
    readonly title: string
    readonly filter?: {
      readonly text?: string
      readonly gate?: "match" | "unknown" | "reject"
      readonly keywordIds?: ReadonlyArray<string>
      readonly includeArchived?: boolean
    }
  }
): Promise<string> => {
  const [row] = await runAs(
    userId,
    ownerTx((tx) =>
      tx
        .insert(preset)
        .values({
          userId,
          kind: input.kind ?? "explore",
          title: input.title,
          filter: (input.filter ?? {}) as Record<string, unknown>
        })
        .returning({ id: preset.id })
    )
  )
  return row!.id
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
  name = unique("harness"),
  kinds: ReadonlyArray<JobKind> = ["browser"]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.register({ name, kinds, accounts })
    })
  )

export const leaseNext = async (
  userId: string,
  harnessId: string,
  token: string,
  accounts: ReadonlyArray<string>,
  kinds: ReadonlyArray<JobKind> = ["browser"]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.leaseNext({ harnessId, token, kinds, accounts })
    })
  )

export const revokeHarness = async (userId: string, harnessId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.revoke({ harnessId })
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
/* Inference calls                                                            */
/* -------------------------------------------------------------------------- */

export const enqueueInference = async (userId: string, input: EnqueueInferenceInput) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.enqueue(input)
    })
  )

export const getInference = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.get(id)
    })
  )

export const getInferenceFailure = async (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.get(id)
    })
  )

/* -------------------------------------------------------------------------- */
/* Crawl calls                                                                */
/* -------------------------------------------------------------------------- */

export const crawlStart = async (
  userId: string,
  input: { readonly url: string; readonly startPage?: number; readonly title?: string }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.start(input)
    })
  )

/** `vacancyIds` is typed loosely on purpose: the seeds hand back plain UUIDs. */
export type CrawlSavePageTestInput = Omit<CrawlSavePageInput, "vacancyIds"> & {
  readonly vacancyIds: ReadonlyArray<string>
}

const crawlSavePageEffect = (input: CrawlSavePageTestInput) =>
  Effect.gen(function*() {
    const crawl = yield* CrawlService
    return yield* crawl.savePage({
      ...input,
      vacancyIds: input.vacancyIds as ReadonlyArray<VacancyId>
    })
  })

export const crawlSavePage = (userId: string, input: CrawlSavePageTestInput) =>
  runAs(userId, crawlSavePageEffect(input))

export const crawlSavePageFailure = (userId: string, input: CrawlSavePageTestInput) =>
  runAsFailure(userId, crawlSavePageEffect(input))

export const crawlFinish = async (
  userId: string,
  input: {
    readonly runId: string
    readonly status: CrawlFinishStatus
    readonly nextPage: number
    readonly pagesDone: number
    readonly found: number
    readonly error?: string | null
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.finish(input)
    })
  )

export const crawlStatus = async (userId: string, runId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.status(runId)
    })
  )

/* -------------------------------------------------------------------------- */
/* Gate and preset calls                                                      */
/* -------------------------------------------------------------------------- */

type LexiconListInput = Parameters<GateServiceShape["lexiconList"]>[0]

export const lexiconList = async (userId: string, options: LexiconListInput = {}) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const gate = yield* GateService
      return yield* gate.lexiconList(options)
    })
  )

export const lexiconListFailure = async (userId: string, options: LexiconListInput = {}) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const gate = yield* GateService
      return yield* gate.lexiconList(options)
    })
  )

export const removePreset = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const presets = yield* PresetService
      return yield* presets.remove(id)
    })
  )

export const findPreset = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const database = yield* Database
      return yield* database
        .asUser(userId, (tx) => PresetRepository.findById(tx, id, userId))
    })
  )

/* -------------------------------------------------------------------------- */
/* Schedule calls                                                             */
/* -------------------------------------------------------------------------- */

export const scheduleUpsert = (userId: string, input: ScheduleUpsertInput) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.upsert(input)
    })
  )

export const scheduleUpsertFailure = (userId: string, input: ScheduleUpsertInput) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.upsert(input)
    })
  )

export const schedulesList = (userId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.list()
    })
  )

export const scheduleRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.remove(id)
    })
  )

export const scheduleRunNow = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

export const scheduleRunNowWithRunner = (
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  id: string
) =>
  runAsWithRunner(
    userId,
    runner,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

export const scheduleRunNowFailure = (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

/** Forces a schedule due (or not) without waiting for its interval. */
export const setScheduleNextRun = async (id: string, nextRunAt: Date | null) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .update(schedule)
        .set({ nextRunAt })
        .where(eq(schedule.id, id))
    )
  )
}

/** Owner read of a schedule row, including columns the DTO hides. */
export const findScheduleRow = async (id: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(schedule)
        .where(eq(schedule.id, id))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const scheduleRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(schedule)
        .where(eq(schedule.userId, userId))
        .orderBy(schedule.createdAt)
    )
  )

/** One worker tick with a fake crawler: no live hh.ru traffic. */
export const runDueSchedulesAs = (
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  options: { readonly now?: Date; readonly limit?: number } = {}
) => runAsWithRunner(userId, runner, runDueSchedules(options))

/** A fake runner that records every target and returns a clean result. */
export const recordingRunner = (targets: Array<string>) => {
  const layer = Layer.succeed(CrawlRunner, {
    run: (input) =>
      Effect.sync(() => {
        targets.push(input.url)
        return {
          runId: randomUUID(),
          status: "done" as const,
          reason: "last_page",
          error: null,
          pagesDone: 1,
          found: 3,
          inserted: 3,
          updated: 0,
          skipped: 0,
          errors: 0
        } satisfies CrawlRunnerResult
      })
  })
  return layer
}

/* -------------------------------------------------------------------------- */
/* Owner reads and writes used by assertions                                  */
/* -------------------------------------------------------------------------- */

export const findJob = async (jobId: string) =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.findById(tx, jobId))
  )

/** The account a job is pinned to; `HarnessJob` itself does not expose it. */
export const jobAccountId = async (jobId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({ hhAccountId: harnessJob.hhAccountId })
        .from(harnessJob)
        .where(eq(harnessJob.id, jobId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.hhAccountId ?? null))
    )
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

export const findSearchQuery = async (normalizedUrl: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: searchQuery.id,
          url: searchQuery.url,
          normalizedUrl: searchQuery.normalizedUrl,
          title: searchQuery.title,
          textQuery: searchQuery.textQuery
        })
        .from(searchQuery)
        .where(eq(searchQuery.normalizedUrl, normalizedUrl))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const searchRunRowsFor = async (queryId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: searchRun.id,
          queryId: searchRun.queryId,
          status: searchRun.status,
          nextPage: searchRun.nextPage,
          pagesDone: searchRun.pagesDone,
          found: searchRun.found,
          error: searchRun.error,
          finishedAt: searchRun.finishedAt
        })
        .from(searchRun)
        .where(eq(searchRun.queryId, queryId))
        .orderBy(asc(searchRun.id))
    )
  )

export const searchHitsFor = async (queryId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          queryId: vacancySearchHit.queryId,
          vacancyId: vacancySearchHit.vacancyId,
          position: vacancySearchHit.position
        })
        .from(vacancySearchHit)
        .where(eq(vacancySearchHit.queryId, queryId))
        .orderBy(asc(vacancySearchHit.position), asc(vacancySearchHit.vacancyId))
    )
  )

/* -------------------------------------------------------------------------- */
/* Raw job rows                                                               */
/* -------------------------------------------------------------------------- */

export interface RawJobInput {
  readonly userId: string
  readonly stage: string
  readonly kind?: string
  /** Written to the `result` column; omitted leaves it null. */
  readonly result?: unknown
}

/**
 * Inserts straight into `harness_jobs`, bypassing the repositories and their
 * defaults. This is how the migration's stage check and the `result` column are
 * exercised without a service in between.
 */
const rawJobInsert = (input: RawJobInput) =>
  ownerTx((tx) =>
    tx
      .execute(sql`
        insert into harness_jobs (user_id, stage, kind, payload, result, idempotency_key)
        values (
          ${input.userId},
          ${input.stage},
          ${input.kind ?? "inference"},
          '{}'::jsonb,
          ${input.result === undefined ? null : JSON.stringify(input.result)}::jsonb,
          ${unique("raw-job")}
        )
        returning id
      `)
      .pipe(Effect.map((result) => (result.rows[0] as { id: string }).id))
  )

export const insertRawJob = async (input: RawJobInput) => runAs(input.userId, rawJobInsert(input))

export const insertRawJobFailure = async (input: RawJobInput) =>
  runAsFailure(input.userId, rawJobInsert(input))
