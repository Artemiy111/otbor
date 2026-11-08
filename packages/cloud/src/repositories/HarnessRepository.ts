import type { AgentCatalog, AgentHarness, HarnessRegistration, JobKind } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { hashesEqual } from "../auth/harnessToken.ts"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { harness, harnessAccount } from "../db/tables.ts"

/**
 * A harness as storage knows it. The plaintext token is deliberately absent:
 * only `HarnessRegister` can hand it to the caller, and it is never read back.
 */
export type HarnessRecord = Omit<HarnessRegistration, "token">

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
): RepoEffect<HarnessRecord> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(harness)
      .values({
        userId: input.userId,
        name: input.name,
        kinds: input.kinds,
        tokenHash: input.tokenHash,
        lastSeenAt: new Date()
      })
      .onConflictDoUpdate({
        target: [harness.userId, harness.name],
        // Re-registering rotates the token: the old device stops working.
        set: {
          kinds: sql`excluded.kinds`,
          tokenHash: sql`excluded.token_hash`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`
        }
      })
      .returning()

    const harnessId = row!.id

    if (input.accounts.length > 0) {
      const accounts = sql.join(input.accounts.map((account) => sql`${account}`), sql`, `)
      // An account can only be served by one harness; registering it here moves
      // it, it does not clone the binding.
      yield* tx.execute(sql`
        delete from harness_account
        where hh_account_id in (${accounts}) and harness_id <> ${harnessId}
      `)
      yield* tx
        .insert(harnessAccount)
        .values(input.accounts.map((account) => ({ userId: input.userId, harnessId, hhAccountId: account })))
        .onConflictDoNothing()
    }

    const accounts = yield* tx
      .select({ hhAccountId: harnessAccount.hhAccountId })
      .from(harnessAccount)
      .where(sql`${harnessAccount.harnessId} = ${harnessId}`)

    return {
      id: harnessId as HarnessRegistration["id"],
      name: row!.name,
      kinds: row!.kinds as ReadonlyArray<JobKind>,
      accounts: accounts.map((account) => account.hhAccountId as HarnessRegistration["accounts"][number]),
      lastSeenAt: (row!.lastSeenAt ?? new Date()).toISOString()
    }
  })

/**
 * The only authentication a harness has: the row must exist for the current
 * user (RLS), the id must match, and the stored hash must equal the hash of the
 * presented token. A revoked harness has a null hash and therefore fails.
 */
export const authenticate = (
  tx: Executor,
  harnessId: string,
  tokenHash: string
): RepoEffect<boolean> =>
  tx
    .select({ tokenHash: harness.tokenHash })
    .from(harness)
    .where(sql`${harness.id} = ${harnessId}`)
    .limit(1)
    .pipe(
      Effect.map(
        (rows) => rows.length === 1 && hashesEqual(rows[0]!.tokenHash, tokenHash)
      )
    )

/** Clears the token hash; the device token can never match again. */
export const revoke = (tx: Executor, harnessId: string): RepoEffect<boolean> =>
  tx
    .update(harness)
    .set({ tokenHash: null })
    .where(sql`${harness.id} = ${harnessId}`)
    .returning({ id: harness.id })
    .pipe(Effect.map((rows) => rows.length > 0))

/** Каждый опрос — признак жизни; потоки харнесса сообщает он сам. */
export const touch = (tx: Executor, harnessId: string, concurrency?: number): RepoEffect<void> =>
  tx
    .update(harness)
    .set({ lastSeenAt: new Date(), ...(concurrency === undefined ? {} : { concurrency }) })
    .where(sql`${harness.id} = ${harnessId}`)
    .pipe(Effect.asVoid)

export const accountsFor = (tx: Executor, harnessId: string): RepoEffect<ReadonlyArray<string>> =>
  tx
    .select({ hhAccountId: harnessAccount.hhAccountId })
    .from(harnessAccount)
    .where(sql`${harnessAccount.harnessId} = ${harnessId}`)
    .pipe(Effect.map((rows) => rows.map((row) => row.hhAccountId)))

export const find = (
  tx: Executor,
  harnessId: string
): RepoEffect<HarnessRecord | null> =>
  Effect.gen(function*() {
    const [row] = yield* tx.select().from(harness).where(sql`${harness.id} = ${harnessId}`).limit(1)
    if (row === undefined) return null
    const accounts = yield* accountsFor(tx, harnessId)
    return {
      id: row.id as HarnessRegistration["id"],
      name: row.name,
      kinds: row.kinds as ReadonlyArray<JobKind>,
      accounts: accounts.map((account) => account as HarnessRegistration["accounts"][number]),
      lastSeenAt: (row.lastSeenAt ?? new Date()).toISOString()
    }
  })

/** What a harness probed. Replaces the previous catalog of that harness. */
export const saveCatalog = (
  tx: Executor,
  harnessId: string,
  harnesses: ReadonlyArray<AgentHarness>
): RepoEffect<void> =>
  tx
    .update(harness)
    .set({ catalog: harnesses, catalogAt: new Date() })
    .where(sql`${harness.id} = ${harnessId}`)
    .pipe(Effect.asVoid)

/** The most recently reported catalog of the user's harnesses. */
export const latestCatalog = (tx: Executor, userId: string): RepoEffect<AgentCatalog> =>
  tx
    .select({ catalog: harness.catalog, catalogAt: harness.catalogAt })
    .from(harness)
    .where(sql`${harness.userId} = ${userId} and ${harness.catalog} is not null`)
    .orderBy(sql`${harness.catalogAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) => ({
        harnesses: rows[0]?.catalog ?? [],
        reportedAt: rows[0]?.catalogAt?.toISOString() ?? null
      }))
    )

/** A harness that polled or heartbeated within this window counts as running. */
export const ONLINE_WINDOW_MS = 120_000

export interface HarnessStatusRow {
  readonly id: string
  readonly name: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<string>
  readonly lastSeenAt: string | null
  readonly online: boolean
}

/** Every harness of the user with the accounts it serves and whether it is polling now. */
export const statusList = (tx: Executor): RepoEffect<ReadonlyArray<HarnessStatusRow>> =>
  Effect.gen(function*() {
    const rows = yield* tx.select().from(harness)
    const links = yield* tx.select().from(harnessAccount)
    const now = Date.now()
    return rows.map((row): HarnessStatusRow => ({
      id: row.id,
      name: row.name,
      kinds: row.kinds as ReadonlyArray<JobKind>,
      accounts: links.filter((l) => l.harnessId === row.id).map((l) => l.hhAccountId),
      lastSeenAt: row.lastSeenAt === null ? null : row.lastSeenAt.toISOString(),
      online: row.tokenHash !== null && row.lastSeenAt !== null && now - row.lastSeenAt.getTime() < ONLINE_WINDOW_MS
    }))
  })
