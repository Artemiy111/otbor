import type { ApplyFilterRecord, ApplyFilterSettings, ApplyFilterSource, PresetFilter } from "@otbor/contract"
import { parseBoosts, parsePresetFilter } from "@otbor/contract"
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
  autoMode: row.autoMode as ApplyFilterRecord["autoMode"],
  dailyLimit: row.dailyLimit,
  batchSize: row.batchSize,
  sort: row.sort as ApplyFilterRecord["sort"],
  sortDirection: row.sortDirection === "asc" ? "asc" : "desc",
  minPriority: Number(row.minPriority),
  requireLetter: row.requireLetter,
  boosts: parseBoosts(row.boosts),
  writingHarness: row.writingHarness,
  writingModel: row.writingModel,
  writingEffort: row.writingEffort,
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
      autoMode: DEFAULT_APPLY_FILTER.autoMode,
      dailyLimit: DEFAULT_APPLY_FILTER.dailyLimit,
      batchSize: DEFAULT_APPLY_FILTER.batchSize,
      sort: DEFAULT_APPLY_FILTER.sort,
      sortDirection: DEFAULT_APPLY_FILTER.sortDirection,
      minPriority: DEFAULT_APPLY_FILTER.minPriority,
      requireLetter: DEFAULT_APPLY_FILTER.requireLetter,
      boosts: DEFAULT_APPLY_FILTER.boosts,
      writingHarness: DEFAULT_APPLY_FILTER.writingHarness,
      writingModel: DEFAULT_APPLY_FILTER.writingModel,
      writingEffort: DEFAULT_APPLY_FILTER.writingEffort,
      templatePresetId: null,
      updatedAt: null
    }
  })

/**
 * The built-in filter for one account. The account's own hide list (and what
 * it hid on hh) always blocked a vacancy; as a rule it needs the account id,
 * so the template's `hidden` rule gets it here (next to the app layer).
 */
const defaultFilterFor = (hhAccountId: string): PresetFilter => ({
  ...DEFAULT_APPLY_FILTER.filter,
  rules: (DEFAULT_APPLY_FILTER.filter.rules ?? []).map((rule) =>
    rule.field === "hidden" ? { ...rule, value: ["app", `account:${hhAccountId}`] } : rule
  )
})

const fromRecord = (record: ApplyFilterRecord, source: ApplyFilterSource): ResolvedApplyFilter => ({
  source,
  id: record.id,
  filter: record.filter,
  minFit: record.minFit,
  tests: record.tests,
  freshHalfLifeHours: record.freshHalfLifeHours,
  autoMode: record.autoMode,
  dailyLimit: record.dailyLimit,
  batchSize: record.batchSize,
  sort: record.sort,
  sortDirection: record.sortDirection,
  minPriority: record.minPriority,
  requireLetter: record.requireLetter,
  boosts: record.boosts,
  writingHarness: record.writingHarness,
  writingModel: record.writingModel,
  writingEffort: record.writingEffort,
  templatePresetId: record.templatePresetId,
  updatedAt: record.updatedAt
})

/** `undefined` keeps the stored value; `null` or a blank string clears it; else the trimmed text. */
export const writingValue = (input: string | null | undefined, stored: string | null): string | null => {
  if (input === undefined) return stored
  const trimmed = input?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

export interface UpsertApplyFilterInput {
  readonly userId: string
  readonly hhAccountId: string
  readonly resumeId: string | null
  readonly filter: PresetFilter
  /** Left out: the stored value, or the default on first save. */
  readonly minFit?: number
  readonly tests?: ApplyFilterSettings["tests"]
  readonly freshHalfLifeHours?: number
  readonly autoMode?: ApplyFilterSettings["autoMode"]
  readonly dailyLimit?: number
  readonly batchSize?: number
  readonly sort?: ApplyFilterSettings["sort"]
  readonly sortDirection?: ApplyFilterSettings["sortDirection"]
  readonly minPriority?: number
  readonly requireLetter?: boolean
  readonly boosts?: ApplyFilterSettings["boosts"]
  /** `undefined` keeps the stored value; `null` or a blank string clears it. */
  readonly writingHarness?: string | null
  readonly writingModel?: string | null
  readonly writingEffort?: string | null
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
        freshHalfLifeHours: input.freshHalfLifeHours ?? existing.freshHalfLifeHours,
        autoMode: input.autoMode ?? existing.autoMode,
        dailyLimit: input.dailyLimit ?? existing.dailyLimit,
        batchSize: input.batchSize ?? existing.batchSize,
        sort: input.sort ?? existing.sort,
        sortDirection: input.sortDirection ?? existing.sortDirection,
        minPriority: input.minPriority ?? existing.minPriority,
        requireLetter: input.requireLetter ?? existing.requireLetter,
        boosts: input.boosts ?? existing.boosts,
        writingHarness: writingValue(input.writingHarness, existing.writingHarness),
        writingModel: writingValue(input.writingModel, existing.writingModel),
        writingEffort: writingValue(input.writingEffort, existing.writingEffort)
      }
      // Only a real change of what decide() reads makes decisions stale; a
      // repeated save would otherwise leave them stale for ever (their input
      // hash is the same). auto_mode, daily_limit, batch_size, sort, sort_direction, writing_* and
      // min_priority, require_letter steer the runner and the cap, not the verdict or fit.
      const scoring = (value: {
        readonly filter: PresetFilter
        readonly minFit: number
        readonly tests: string
        readonly freshHalfLifeHours: number
        readonly boosts: ApplyFilterSettings["boosts"]
      }) => ({
        filter: value.filter,
        minFit: value.minFit,
        tests: value.tests,
        freshHalfLifeHours: value.freshHalfLifeHours,
        boosts: value.boosts
      })
      const changed =
        stableHash(scoring({ ...next, filter: parsePresetFilter(next.filter) })) !==
        stableHash(scoring(existing))
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
        autoMode: input.autoMode ?? DEFAULT_APPLY_FILTER.autoMode,
        dailyLimit: input.dailyLimit ?? DEFAULT_APPLY_FILTER.dailyLimit,
        batchSize: input.batchSize ?? DEFAULT_APPLY_FILTER.batchSize,
        sort: input.sort ?? DEFAULT_APPLY_FILTER.sort,
        sortDirection: input.sortDirection ?? DEFAULT_APPLY_FILTER.sortDirection,
        minPriority: input.minPriority ?? DEFAULT_APPLY_FILTER.minPriority,
        requireLetter: input.requireLetter ?? DEFAULT_APPLY_FILTER.requireLetter,
        boosts: [...(input.boosts ?? DEFAULT_APPLY_FILTER.boosts)],
        writingHarness: writingValue(input.writingHarness, null),
        writingModel: writingValue(input.writingModel, null),
        writingEffort: writingValue(input.writingEffort, null),
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

/**
 * The daily response limit stored on the account-level row (resume null), or
 * null when the account has none; the caller then falls back to the env/default.
 */
export const accountDailyLimit = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): RepoEffect<number | null> =>
  tx
    .select({ dailyLimit: applyFilter.dailyLimit })
    .from(applyFilter)
    .where(
      sql`${applyFilter.userId} = ${userId} and ${applyFilter.hhAccountId} = ${hhAccountId} and ${applyFilter.resumeId} is null`
    )
    .limit(1)
    .pipe(Effect.map((rows) => rows[0]?.dailyLimit ?? null))

/**
 * Every apply filter row of the user, optionally of one account. The auto-apply
 * runner reads the modes from here: an account row (resume null) and pair rows.
 */
export const listForUser = (
  tx: Executor,
  userId: string,
  hhAccountId: string | null = null
): RepoEffect<ReadonlyArray<ApplyFilterRecord>> =>
  tx
    .select()
    .from(applyFilter)
    .where(
      hhAccountId === null
        ? sql`${applyFilter.userId} = ${userId}`
        : sql`${applyFilter.userId} = ${userId} and ${applyFilter.hhAccountId} = ${hhAccountId}`
    )
    .pipe(Effect.map((rows) => rows.map(toRecord)))

/**
 * SQL-скаляр: `auto_mode`, который управляет строкой application `alias`.
 * Решает парная строка (аккаунт, резюме), если она есть, иначе строка аккаунта
 * (resume NULL), иначе `off`. Одно определение для шлюза отправки, понижения
 * при смене режима и повтора в раннере.
 */
export const governingAutoModeSql = (alias: string) => {
  const a = sql.identifier(alias)
  return sql`coalesce(
    (select f.auto_mode from apply_filter f
      where f.user_id = ${a}.user_id and f.hh_account_id = ${a}.hh_account_id and f.resume_id = ${a}.resume_id
      limit 1),
    (select f.auto_mode from apply_filter f
      where f.user_id = ${a}.user_id and f.hh_account_id = ${a}.hh_account_id and f.resume_id is null
      limit 1),
    'off')`
}

/**
 * `auto_mode`, который сейчас управляет парой (аккаунт, резюме): парная
 * строка, если есть, иначе строка аккаунта, иначе `off`.
 */
export const governingAutoMode = (
  tx: Executor,
  userId: string,
  hhAccountId: string,
  resumeId: string | null
): RepoEffect<ApplyFilterRecord["autoMode"]> =>
  Effect.gen(function*() {
    const pair = resumeId === null ? null : yield* find(tx, userId, hhAccountId, resumeId)
    if (pair !== null) return pair.autoMode
    const account = yield* find(tx, userId, hhAccountId, null)
    return account?.autoMode ?? "off"
  })
