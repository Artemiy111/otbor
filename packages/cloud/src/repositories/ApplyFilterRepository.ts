import type { ApplyFilterRecord, ApplyFilterSettings, ApplyFilterSource, PresetFilter } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { DEFAULT_APPLY_FILTER } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { applyFilter } from "../db/tables.ts"
import { stableHash } from "../services/support.ts"

export const toRecord = (row: typeof applyFilter.$inferSelect): ApplyFilterRecord => ({
  id: row.id as ApplyFilterRecord["id"],
  hhAccountId: row.hhAccountId as ApplyFilterRecord["hhAccountId"],
  resumeId: row.resumeId as ApplyFilterRecord["resumeId"],
  filter: parsePresetFilter(row.filter),
  minFit: row.minFit,
  tests: row.tests as ApplyFilterRecord["tests"],
  freshHalfLifeHours: row.freshHalfLifeHours,
  templatePresetId: row.templatePresetId as ApplyFilterRecord["templatePresetId"],
  updatedAt: row.updatedAt.toISOString()
})

/** The filter and settings that apply to one (account, resume), and where they came from. */
export interface ResolvedApplyFilter extends ApplyFilterSettings {
  readonly source: ApplyFilterSource
  /** Null for the built-in default: nothing is stored. */
  readonly id: string | null
  readonly filter: PresetFilter
  readonly templatePresetId: string | null
  readonly updatedAt: string | null
}

/** The row for exactly this pair; `resumeId` null is the account-wide row. */
export const find = (
  tx: Executor,
  userId: string,
  hhAccountId: string,
  resumeId: string | null
): RepoEffect<ApplyFilterRecord | null> =>
  tx
    .select()
    .from(applyFilter)
    .where(
      resumeId === null
        ? sql`${applyFilter.userId} = ${userId} and ${applyFilter.hhAccountId} = ${hhAccountId} and ${applyFilter.resumeId} is null`
        : sql`${applyFilter.userId} = ${userId} and ${applyFilter.hhAccountId} = ${hhAccountId} and ${applyFilter.resumeId} = ${resumeId}`
    )
    .limit(1)
    .pipe(Effect.map((rows) => (rows[0] === undefined ? null : toRecord(rows[0]))))

/**
 * The fallback chain: the exact (account, resume) row, else the account row
 * (resume null), else the built-in default. No account at all is the default.
 */
export const resolve = (
  tx: Executor,
  userId: string,
  hhAccountId: string | null,
  resumeId: string | null
): RepoEffect<ResolvedApplyFilter> =>
  Effect.gen(function*() {
    if (hhAccountId !== null) {
      const exact = resumeId === null ? null : yield* find(tx, userId, hhAccountId, resumeId)
      if (exact !== null) return fromRecord(exact, "exact")
      const account = yield* find(tx, userId, hhAccountId, null)
      if (account !== null) return fromRecord(account, resumeId === null ? "exact" : "account")
    }
    return {
      source: "default",
      id: null,
      filter: hhAccountId === null ? DEFAULT_APPLY_FILTER.filter : defaultFilterFor(hhAccountId),
      minFit: DEFAULT_APPLY_FILTER.minFit,
      tests: DEFAULT_APPLY_FILTER.tests,
      freshHalfLifeHours: DEFAULT_APPLY_FILTER.freshHalfLifeHours,
      templatePresetId: null,
      updatedAt: null
    }
  })

/**
 * The built-in filter for one account. The account's own hide list (and what
 * it hid on hh) always blocked a vacancy; as a rule it needs the account id,
 * so it is added here rather than to the static template. The app-wide
 * blacklist is an implicit clause of every filter.
 */
const defaultFilterFor = (hhAccountId: string): PresetFilter => ({
  ...DEFAULT_APPLY_FILTER.filter,
  rules: [
    ...(DEFAULT_APPLY_FILTER.filter.rules ?? []),
    { field: "hidden", op: "not_in", value: [`account:${hhAccountId}`] }
  ]
})

const fromRecord = (record: ApplyFilterRecord, source: ApplyFilterSource): ResolvedApplyFilter => ({
  source,
  id: record.id,
  filter: record.filter,
  minFit: record.minFit,
  tests: record.tests,
  freshHalfLifeHours: record.freshHalfLifeHours,
  templatePresetId: record.templatePresetId,
  updatedAt: record.updatedAt
})

export interface UpsertApplyFilterInput {
  readonly userId: string
  readonly hhAccountId: string
  readonly resumeId: string | null
  readonly filter: PresetFilter
  /** Left out: the stored value, or the default on first save. */
  readonly minFit?: number
  readonly tests?: ApplyFilterSettings["tests"]
  readonly freshHalfLifeHours?: number
  /** `undefined` keeps the stored value; `null` clears it. */
  readonly templatePresetId?: string | null
}

export const upsert = (
  tx: Executor,
  input: UpsertApplyFilterInput
): RepoEffect<ApplyFilterRecord> =>
  Effect.gen(function*() {
    const existing = yield* find(tx, input.userId, input.hhAccountId, input.resumeId)
    const filter = input.filter as Record<string, unknown>

    if (existing !== null) {
      const next = {
        filter,
        minFit: input.minFit ?? existing.minFit,
        tests: input.tests ?? existing.tests,
        freshHalfLifeHours: input.freshHalfLifeHours ?? existing.freshHalfLifeHours
      }
      // Only a real change of the rules makes decisions stale; a repeated save
      // would otherwise leave them stale for ever (their input hash is the same).
      const changed =
        stableHash({ ...next, filter: parsePresetFilter(next.filter) }) !==
        stableHash({
          filter: existing.filter,
          minFit: existing.minFit,
          tests: existing.tests,
          freshHalfLifeHours: existing.freshHalfLifeHours
        })
      const [row] = yield* tx
        .update(applyFilter)
        .set({
          ...next,
          templatePresetId: input.templatePresetId === undefined
            ? existing.templatePresetId
            : input.templatePresetId,
          ...(changed ? { rulesChangedAt: sql`now()` } : {})
        })
        .where(sql`${applyFilter.id} = ${existing.id}`)
        .returning()
      return toRecord(row!)
    }

    const [row] = yield* tx
      .insert(applyFilter)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        resumeId: input.resumeId,
        filter,
        minFit: input.minFit ?? DEFAULT_APPLY_FILTER.minFit,
        tests: input.tests ?? DEFAULT_APPLY_FILTER.tests,
        freshHalfLifeHours: input.freshHalfLifeHours ?? DEFAULT_APPLY_FILTER.freshHalfLifeHours,
        templatePresetId: input.templatePresetId ?? null
      })
      .returning()
    return toRecord(row!)
  })

/** Whether the hh account (and the resume, when given) exist for this user (RLS-scoped). */
export const targetExists = (
  tx: Executor,
  hhAccountId: string,
  resumeId: string | null
): RepoEffect<{ readonly account: boolean; readonly resume: boolean }> =>
  Effect.gen(function*() {
    const account = yield* tx.execute(sql`select 1 from hh_account where id = ${hhAccountId} limit 1`)
    if (resumeId === null) return { account: account.rows.length > 0, resume: true }
    const resume = yield* tx.execute(
      sql`select 1 from resume where id = ${resumeId} and hh_account_id = ${hhAccountId} limit 1`
    )
    return { account: account.rows.length > 0, resume: resume.rows.length > 0 }
  })
