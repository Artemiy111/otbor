import type { HarnessRegistration, JobKind } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { harness, harnessAccount } from "../db/tables.ts"

export const register = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly name: string
    readonly kinds: ReadonlyArray<JobKind>
    readonly accounts: ReadonlyArray<string>
  }
): RepoEffect<HarnessRegistration> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(harness)
      .values({
        userId: input.userId,
        name: input.name,
        kinds: input.kinds,
        lastSeenAt: new Date()
      })
      .onConflictDoUpdate({
        target: [harness.userId, harness.name],
        set: { kinds: sql`excluded.kinds`, lastSeenAt: sql`now()`, updatedAt: sql`now()` }
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

export const touch = (tx: Executor, harnessId: string): RepoEffect<void> =>
  tx
    .update(harness)
    .set({ lastSeenAt: new Date() })
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
): RepoEffect<HarnessRegistration | null> =>
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
