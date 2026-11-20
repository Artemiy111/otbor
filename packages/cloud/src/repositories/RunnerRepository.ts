import type { AgentCatalog, AgentHarness, RunnerRegistration, JobKind } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { hashesEqual } from "../auth/runnerToken.ts"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { runner, runnerAccount } from "../db/tables.ts"

/**
 * A runner as storage knows it. The plaintext token is deliberately absent:
 * only `RunnerRegister` can hand it to the caller, and it is never read back.
 */
export type RunnerRecord = Omit<RunnerRegistration, "token">

export const register = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly name: string
    readonly kinds: ReadonlyArray<JobKind>
    readonly accounts: ReadonlyArray<string>
    /** SHA-256 of the freshly generated device token. */
    readonly tokenHash: string
  }
): RepoEffect<RunnerRecord> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(runner)
      .values({
        userId: input.userId,
        name: input.name,
        kinds: input.kinds,
        tokenHash: input.tokenHash,
        lastSeenAt: new Date()
      })
      .onConflictDoUpdate({
        target: [runner.userId, runner.name],
        // Re-registering rotates the token: the old device stops working.
        set: {
          kinds: sql`excluded.kinds`,
          tokenHash: sql`excluded.token_hash`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`
        }
      })
      .returning()

    const runnerId = row!.id

    if (input.accounts.length > 0) {
      const accounts = sql.join(input.accounts.map((account) => sql`${account}`), sql`, `)
      // An account can only be served by one runner; registering it here moves
      // it, it does not clone the binding.
      yield* tx.execute(sql`
        delete from runner_account
        where hh_account_id in (${accounts}) and runner_id <> ${runnerId}
      `)
      yield* tx
        .insert(runnerAccount)
        .values(input.accounts.map((account) => ({ userId: input.userId, runnerId, hhAccountId: account })))
        .onConflictDoNothing()
    }

    const accounts = yield* tx
      .select({ hhAccountId: runnerAccount.hhAccountId })
      .from(runnerAccount)
      .where(sql`${runnerAccount.runnerId} = ${runnerId}`)

    return {
      id: runnerId as RunnerRegistration["id"],
      name: row!.name,
      kinds: row!.kinds as ReadonlyArray<JobKind>,
      accounts: accounts.map((account) => account.hhAccountId as RunnerRegistration["accounts"][number]),
      lastSeenAt: (row!.lastSeenAt ?? new Date()).toISOString()
    }
  })

/**
 * The only authentication a runner has: the row must exist for the current
 * user (RLS), the id must match, and the stored hash must equal the hash of the
 * presented token. A revoked runner has a null hash and therefore fails.
 */
export const authenticate = (
  tx: Executor,
  runnerId: string,
  tokenHash: string
): RepoEffect<boolean> =>
  tx
    .select({ tokenHash: runner.tokenHash })
    .from(runner)
    .where(sql`${runner.id} = ${runnerId}`)
    .limit(1)
    .pipe(
      Effect.map(
        (rows) => rows.length === 1 && hashesEqual(rows[0]!.tokenHash, tokenHash)
      )
    )

/** Clears the token hash; the device token can never match again. */
export const revoke = (tx: Executor, runnerId: string): RepoEffect<boolean> =>
  tx
    .update(runner)
    .set({ tokenHash: null })
    .where(sql`${runner.id} = ${runnerId}`)
    .returning({ id: runner.id })
    .pipe(Effect.map((rows) => rows.length > 0))

/** Каждый опрос — признак жизни; потоки раннера сообщает он сам. */
export const touch = (tx: Executor, runnerId: string, concurrency?: number): RepoEffect<void> =>
  tx
    .update(runner)
    .set({ lastSeenAt: new Date(), ...(concurrency === undefined ? {} : { concurrency }) })
    .where(sql`${runner.id} = ${runnerId}`)
    .pipe(Effect.asVoid)

export const accountsFor = (tx: Executor, runnerId: string): RepoEffect<ReadonlyArray<string>> =>
  tx
    .select({ hhAccountId: runnerAccount.hhAccountId })
    .from(runnerAccount)
    .where(sql`${runnerAccount.runnerId} = ${runnerId}`)
    .pipe(Effect.map((rows) => rows.map((row) => row.hhAccountId)))

export const find = (
  tx: Executor,
  runnerId: string
): RepoEffect<RunnerRecord | null> =>
  Effect.gen(function*() {
    const [row] = yield* tx.select().from(runner).where(sql`${runner.id} = ${runnerId}`).limit(1)
    if (row === undefined) return null
    const accounts = yield* accountsFor(tx, runnerId)
    return {
      id: row.id as RunnerRegistration["id"],
      name: row.name,
      kinds: row.kinds as ReadonlyArray<JobKind>,
      accounts: accounts.map((account) => account as RunnerRegistration["accounts"][number]),
      lastSeenAt: (row.lastSeenAt ?? new Date()).toISOString()
    }
  })

/** What a harness probed. Replaces the previous catalog of that harness. */
export const saveCatalog = (
  tx: Executor,
  runnerId: string,
  harnesses: ReadonlyArray<AgentHarness>
): RepoEffect<void> =>
  tx
    .update(runner)
    .set({ catalog: harnesses, catalogAt: new Date() })
    .where(sql`${runner.id} = ${runnerId}`)
    .pipe(Effect.asVoid)

/** The most recently reported catalog of the user's harnesses. */
export const latestCatalog = (tx: Executor, userId: string): RepoEffect<AgentCatalog> =>
  tx
    .select({ catalog: runner.catalog, catalogAt: runner.catalogAt })
    .from(runner)
    .where(sql`${runner.userId} = ${userId} and ${runner.catalog} is not null`)
    .orderBy(sql`${runner.catalogAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) => ({
        harnesses: rows[0]?.catalog ?? [],
        reportedAt: rows[0]?.catalogAt?.toISOString() ?? null
      }))
    )

/** A runner that polled or heartbeated within this window counts as running. */
export const ONLINE_WINDOW_MS = 120_000

export interface RunnerStatusRow {
  readonly id: string
  readonly name: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<string>
  readonly lastSeenAt: string | null
  readonly online: boolean
}

/** Every runner of the user with the accounts it serves and whether it is polling now. */
export const statusList = (tx: Executor): RepoEffect<ReadonlyArray<RunnerStatusRow>> =>
  Effect.gen(function*() {
    const rows = yield* tx.select().from(runner)
    const links = yield* tx.select().from(runnerAccount)
    const now = Date.now()
    return rows.map((row): RunnerStatusRow => ({
      id: row.id,
      name: row.name,
      kinds: row.kinds as ReadonlyArray<JobKind>,
      accounts: links.filter((l) => l.runnerId === row.id).map((l) => l.hhAccountId),
      lastSeenAt: row.lastSeenAt === null ? null : row.lastSeenAt.toISOString(),
      online: row.tokenHash !== null && row.lastSeenAt !== null && now - row.lastSeenAt.getTime() < ONLINE_WINDOW_MS
    }))
  })
