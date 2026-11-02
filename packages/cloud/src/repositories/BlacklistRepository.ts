import type { BlacklistRecord, BlacklistScope, BlacklistTarget } from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { hiddenTarget as hiddenTargetTable } from "../db/tables.ts"

/**
 * Layer matching is deliberately pure and shared by the unit tests and the
 * decision path: a row matches a target when its layer applies to the selected
 * account and its type/external id equals the employer or vacancy.
 */
export interface BlacklistMatch {
  readonly scope: BlacklistScope
  readonly target: BlacklistTarget
}

export interface BlacklistCandidate {
  readonly scope: string
  readonly hhAccountId: string | null
  readonly type: string
  readonly externalId: string
}

export interface BlacklistTargetInput {
  readonly hhAccountId?: string | null
  readonly employerExternalId?: string | null
  readonly vacancyExternalId?: string | null
}

const scopeRank: Record<string, number> = {
  app: 0,
  hh_account: 1,
  hh_native: 2
}

/** Distinct scopes, app first, for `VacancySummary.blacklistLayers`. */
export const matchedLayers = (
  candidates: ReadonlyArray<BlacklistCandidate>,
  input: BlacklistTargetInput
): ReadonlyArray<BlacklistMatch> => {
  const accountId = input.hhAccountId ?? null
  const matches: Array<BlacklistMatch> = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.scope !== "app") {
      if (accountId === null || candidate.hhAccountId !== accountId) continue
    }

    let target: BlacklistTarget | null = null
    if (
      candidate.type === "employer" &&
      input.employerExternalId !== null &&
      input.employerExternalId !== undefined &&
      candidate.externalId === input.employerExternalId
    ) {
      target = "employer"
    } else if (
      candidate.type === "vacancy" &&
      input.vacancyExternalId !== null &&
      input.vacancyExternalId !== undefined &&
      candidate.externalId === input.vacancyExternalId
    ) {
      target = "vacancy"
    }

    if (target === null) continue
    const key = `${candidate.scope}:${target}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({ scope: candidate.scope as BlacklistScope, target })
  }

  return matches.sort(
    (left, right) =>
      (scopeRank[left.scope] ?? 99) - (scopeRank[right.scope] ?? 99) ||
      left.target.localeCompare(right.target)
  )
}

export const matchedScopes = (
  matches: ReadonlyArray<BlacklistMatch>
): ReadonlyArray<BlacklistScope> => [...new Set(matches.map((match) => match.scope))]

/** The target seen first by a decision reason: app outranks account/native. */
export const primaryMatch = (
  matches: ReadonlyArray<BlacklistMatch>
): BlacklistMatch | null => matches[0] ?? null

/* -------------------------------------------------------------------------- */
/* SQL fragments                                                              */
/* -------------------------------------------------------------------------- */

const accountLayerClause = (hhAccountId: string | null): SQL =>
  hhAccountId === null
    ? sql`false`
    : sql`(ht.scope in ('hh_account', 'hh_native') and ht.hh_account_id = ${hhAccountId}::uuid)`

const targetClause = (input: {
  readonly employerExternalId: SQL
  readonly vacancyExternalId: SQL
}): SQL =>
  sql`(
    (ht.type = 'employer' and ${input.employerExternalId} is not null and ht.external_id = ${input.employerExternalId})
    or (ht.type = 'vacancy' and ht.external_id = ${input.vacancyExternalId})
  )`

export interface LayersSqlInput {
  readonly userId?: string
  readonly hhAccountId?: string | null
  readonly employerExternalId: SQL
  readonly vacancyExternalId: SQL
}

/** A JSON array of matched scopes, used both for labels and for summary rows. */
export const layersSql = (input: LayersSqlInput): SQL => {
  if (input.userId === undefined) return sql`'[]'::json`
  const accountId = input.hhAccountId ?? null

  return sql`coalesce((
    select json_agg(distinct ht.scope order by ht.scope)
    from hidden_target ht
    where ht.user_id = ${input.userId}
      and ${targetClause(input)}
      and (ht.scope = 'app' or ${accountLayerClause(accountId)})
  ), '[]'::json)`
}

/** `true` when any layer applicable to this page matches the row. */
export const matchExistsSql = (input: LayersSqlInput): SQL => {
  if (input.userId === undefined) return sql`false`
  const accountId = input.hhAccountId ?? null

  return sql`exists (
    select 1 from hidden_target ht
    where ht.user_id = ${input.userId}
      and ${targetClause(input)}
      and (ht.scope = 'app' or ${accountLayerClause(accountId)})
  )`
}

/**
 * Presets exclude the app layer only; an account list never leaks into a
 * shared preset preview.
 */
export const appBlacklistExistsSql = (input: {
  readonly userId: string
  readonly employerExternalId: SQL
  readonly vacancyExternalId: SQL
}): SQL =>
  sql`exists (
    select 1 from hidden_target ht
    where ht.user_id = ${input.userId}
      and ht.scope = 'app'
      and ${targetClause(input)}
  )`

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

interface BlacklistRow {
  readonly id: string
  readonly scope: string
  readonly hh_account_id: string | null
  readonly type: string
  readonly external_id: string
  readonly name: string | null
  readonly source: string
  readonly reason: string | null
  readonly created_at: Date
  readonly updated_at: Date
  readonly last_seen_at: Date | null
}

export const toRecord = (row: BlacklistRow): BlacklistRecord => ({
  id: row.id as BlacklistRecord["id"],
  scope: row.scope as BlacklistScope,
  hhAccountId: row.hh_account_id as BlacklistRecord["hhAccountId"],
  targetType: row.type as BlacklistTarget,
  externalId: row.external_id,
  name: row.name,
  source: row.source as BlacklistRecord["source"],
  reason: row.reason,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastSeenAt: row.last_seen_at?.toISOString() ?? null
})

export interface BlacklistFilter {
  readonly scope?: BlacklistScope
  readonly hhAccountId?: string
  readonly targetType?: BlacklistTarget
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export const list = (tx: Executor, filter: BlacklistFilter = {}) => {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
  const offset = Math.max(filter.offset ?? 0, 0)
  const query = filter.query?.trim() ?? ""
  const pattern = query === "" ? null : `%${query.replace(/[%_]/g, "\\$&")}%`

  const where = sql.join(
    [
      filter.scope === undefined ? sql`true` : sql`scope = ${filter.scope}`,
      filter.hhAccountId === undefined
        ? sql`true`
        : sql`hh_account_id = ${filter.hhAccountId}::uuid`,
      filter.targetType === undefined ? sql`true` : sql`type = ${filter.targetType}`,
      pattern === null
        ? sql`true`
        : sql`(coalesce(name, '') ilike ${pattern} or external_id ilike ${pattern})`
    ],
    sql` and `
  )

  return Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select * from hidden_target
      where ${where}
      order by
        case scope when 'app' then 0 when 'hh_account' then 1 else 2 end,
        coalesce(name, external_id)
      limit ${limit} offset ${offset}
    `)
    const total = yield* tx.execute(sql`
      select count(*)::int as count from hidden_target where ${where}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<BlacklistRow>).map(toRecord),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })
}

export const findById = (tx: Executor, id: string): RepoEffect<BlacklistRecord | null> =>
  tx
    .execute(sql`select * from hidden_target where id = ${id} limit 1`)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as BlacklistRow | undefined
        return row === undefined ? null : toRecord(row)
      })
    )

/** Invalid scope/account combinations are refused before touching the table. */
export const validateInput = (input: {
  readonly scope: BlacklistScope
  readonly hhAccountId?: string | null
  readonly externalId: string
}): string | null => {
  if (input.externalId.trim() === "") return "externalId must not be empty"
  if (input.scope === "app" && input.hhAccountId !== null && input.hhAccountId !== undefined) {
    return "app scope must not have an hhAccountId"
  }
  if (input.scope !== "app" && (input.hhAccountId === null || input.hhAccountId === undefined)) {
    return `${input.scope} scope requires an hhAccountId`
  }
  return null
}

export interface UpsertBlacklistInput {
  readonly userId: string
  readonly id?: string
  readonly scope: BlacklistScope
  readonly hhAccountId?: string | null
  readonly targetType: BlacklistTarget
  readonly externalId: string
  readonly name?: string | null
  readonly reason?: string | null
}

export const upsert = (tx: Executor, input: UpsertBlacklistInput): RepoEffect<BlacklistRecord> =>
  Effect.gen(function*() {
    if (input.id !== undefined && input.id !== null) {
      const result = yield* tx.execute(sql`
        update hidden_target set
          scope = ${input.scope},
          hh_account_id = ${input.hhAccountId ?? null}::uuid,
          type = ${input.targetType},
          external_id = ${input.externalId.trim()},
          name = coalesce(${input.name ?? null}, name),
          reason = coalesce(${input.reason ?? null}, reason),
          updated_at = now()
        where id = ${input.id}
        returning *
      `)
      const row = result.rows[0] as unknown as BlacklistRow | undefined
      if (row !== undefined) return toRecord(row)
    }

    const accountId = input.hhAccountId ?? null
    const conflict = input.scope === "app"
      ? sql`(user_id, type, external_id) where scope = 'app'`
      : sql`(hh_account_id, type, external_id) where scope in ('hh_account', 'hh_native')`

    const rows = yield* tx.execute(sql`
      insert into hidden_target
        (user_id, hh_account_id, scope, type, external_id, name, source, reason)
      values (
        ${input.userId}, ${accountId}::uuid, ${input.scope}, ${input.targetType},
        ${input.externalId.trim()}, ${input.name ?? null}, 'user', ${input.reason ?? null}
      )
      on conflict ${conflict}
      do update set
        name = coalesce(excluded.name, hidden_target.name),
        reason = coalesce(excluded.reason, hidden_target.reason),
        updated_at = now()
      returning *
    `)

    return toRecord(rows.rows[0] as unknown as BlacklistRow)
  })

// The typed table is only used by the update-by-id branch; raw SQL handles the
// two different conflict targets.

export const remove = (tx: Executor, id: string): RepoEffect<boolean> =>
  tx
    .delete(hiddenTargetTable)
    .where(sql`${hiddenTargetTable.id} = ${id}`)
    .returning({ id: hiddenTargetTable.id })
    .pipe(Effect.map((rows) => rows.length > 0))

export interface ImportHhInput {
  readonly userId: string
  readonly hhAccountId: string
  readonly entries: ReadonlyArray<{
    readonly targetType: BlacklistTarget
    readonly externalId: string
    readonly name?: string
  }>
}

/**
 * Importing is idempotent by target. An absent entry is left alone, never
 * deleted: removing a row from hh's hidden list is not a signal to unblock it
 * locally. If the same target already exists at another account layer, the
 * import updates its name/last-seen timestamp instead of duplicating it.
 */
export const importHh = (tx: Executor, input: ImportHhInput) =>
  Effect.gen(function*() {
    let imported = 0
    let updated = 0
    let skipped = 0
    const seen = new Set<string>()

    for (const entry of input.entries) {
      const externalId = entry.externalId.trim()
      const key = `${entry.targetType}:${externalId}`
      if (externalId === "" || seen.has(key)) {
        skipped += 1
        continue
      }
      seen.add(key)

      const result = yield* tx.execute(sql`
        insert into hidden_target
          (user_id, hh_account_id, scope, type, external_id, name, source, last_seen_at)
        values (
          ${input.userId}, ${input.hhAccountId}::uuid, 'hh_native', ${entry.targetType},
          ${externalId}, ${entry.name ?? null}, 'hh_hidden', now()
        )
        on conflict (hh_account_id, type, external_id)
        do update set
          name = coalesce(excluded.name, hidden_target.name),
          last_seen_at = now(),
          updated_at = now()
        returning (xmax = 0) as inserted
      `)

      const row = result.rows[0] as { inserted?: boolean } | undefined
      if (row?.inserted === true) imported += 1
      else updated += 1
    }

    return { imported, updated, skipped }
  })

/** All matches for one vacancy, using the pure matcher over the user's rows. */
export const layersFor = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId?: string | null
    readonly employerExternalId: string | null
    readonly vacancyExternalId: string
  }
): RepoEffect<ReadonlyArray<BlacklistMatch>> =>
  tx
    .execute(sql`
      select scope, hh_account_id, type, external_id
      from hidden_target
      where user_id = ${input.userId}
    `)
    .pipe(
      Effect.map((result) =>
        matchedLayers(
          (result.rows as unknown as ReadonlyArray<{
            scope: string
            hh_account_id: string | null
            type: string
            external_id: string
          }>).map((row) => ({
            scope: row.scope,
            hhAccountId: row.hh_account_id,
            type: row.type,
            externalId: row.external_id
          })),
          {
            hhAccountId: input.hhAccountId ?? null,
            employerExternalId: input.employerExternalId,
            vacancyExternalId: input.vacancyExternalId
          }
        )
      )
    )
