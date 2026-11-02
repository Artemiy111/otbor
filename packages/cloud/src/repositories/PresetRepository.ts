import type { PresetFilter, PresetRecord } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { preset } from "../db/tables.ts"

const toRecord = (row: typeof preset.$inferSelect): PresetRecord => ({
  id: row.id as PresetRecord["id"],
  userId: row.userId as PresetRecord["userId"],
  kind: row.kind as PresetRecord["kind"],
  title: row.title,
  filter: parsePresetFilter(row.filter),
  system: row.system,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
})

export const list = (
  tx: Executor,
  options: { readonly kind?: string; readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<PresetRecord>> =>
  tx
    .select()
    .from(preset)
    .where(
      options.kind === undefined || options.kind === ""
        ? sql`true`
        : sql`${preset.kind} = ${options.kind}`
    )
    .orderBy(sql`${preset.system} desc, ${preset.title}`)
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))
    .pipe(Effect.map((rows) => rows.map(toRecord)))

/**
 * A preset the user may apply: their own row or a system row. RLS already
 * enforces this in `asUser`; the explicit predicate keeps the rule true when
 * the repository is called as the owner.
 */
export const findById = (
  tx: Executor,
  id: string,
  userId: string
): RepoEffect<PresetRecord | null> =>
  tx
    .select()
    .from(preset)
    .where(
      sql`${preset.id} = ${id} and (${preset.userId} is null or ${preset.userId} = ${userId})`
    )
    .limit(1)
    .pipe(Effect.map((rows) => (rows[0] === undefined ? null : toRecord(rows[0]))))

/** Deletes only the caller's own preset; system presets stay untouched. */
export const remove = (tx: Executor, id: string, userId: string): RepoEffect<boolean> =>
  tx
    .delete(preset)
    .where(sql`${preset.id} = ${id} and ${preset.userId} = ${userId}`)
    .returning({ id: preset.id })
    .pipe(Effect.map((rows) => rows.length > 0))

export const upsert = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly id?: string | null
    readonly kind: "explore" | "apply"
    readonly title: string
    readonly filter: PresetFilter
    readonly system?: boolean
  }
): RepoEffect<PresetRecord> =>
  Effect.gen(function*() {
    if (input.id !== null && input.id !== undefined) {
      const [row] = yield* tx
        .update(preset)
        .set({
          kind: input.kind,
          title: input.title,
          filter: input.filter as Record<string, unknown>,
          updatedAt: new Date()
        })
        .where(sql`${preset.id} = ${input.id}`)
        .returning()
      if (row !== undefined) return toRecord(row)
    }

    const [row] = yield* tx
      .insert(preset)
      .values({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        filter: input.filter as Record<string, unknown>,
        system: input.system ?? false
      })
      .returning()

    return toRecord(row!)
  })
