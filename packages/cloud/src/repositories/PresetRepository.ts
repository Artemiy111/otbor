import type { PresetFilter, PresetPreview, PresetRecord } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { employer, preset, vacancy } from "../db/tables.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"
import { vacancyFilterSql } from "./LexiconRepository.ts"
import * as VacancyRepository from "./VacancyRepository.ts"

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

const facetRows = (rows: ReadonlyArray<Record<string, unknown>>) =>
  rows.map((row) => ({
    term: String(row.term),
    count: Number(row.count ?? 0)
  }))

/** Live counts and facets for an unsaved filter. */
export const preview = (
  tx: Executor,
  filter: PresetFilter,
  options: { readonly userId?: string } = {}
): RepoEffect<PresetPreview> =>
  Effect.gen(function*() {
    const where = vacancyFilterSql(filter, { userId: options.userId })

    const countRows = yield* tx.execute(sql`
      select count(*)::int as count from vacancy where ${where}
    `)
    const keywordRows = yield* tx.execute(sql`
      select k.term as term, count(distinct vk.vacancy_id)::int as count
      from keyword k
      join vacancy_keyword vk on vk.keyword_id = k.id
      join vacancy on vacancy.id = vk.vacancy_id
      where ${where}
      group by k.term
      order by count desc, k.term
      limit 12
    `)
    const skillRows = yield* tx.execute(sql`
      select vs.term as term, count(distinct vs.vacancy_id)::int as count
      from vacancy_skill vs
      join vacancy on vacancy.id = vs.vacancy_id
      where ${where}
      group by vs.term
      order by count desc, vs.term
      limit 12
    `)
    const companyRows = yield* tx.execute(sql`
      select e.id::text as id, e.name as name, count(*)::int as count
      from vacancy
      join employer e on e.id = vacancy.employer_id
      where ${where}
      group by e.id, e.name
      order by count desc, e.name
      limit 12
    `)
    const vacancyRows = yield* tx
      .select({
        ...VacancyRepository.rowSelection,
        blacklistLayers: BlacklistRepository.layersSql({
          userId: options.userId,
          hhAccountId: null,
          employerExternalId: sql`${employer.externalId}`,
          vacancyExternalId: sql`${vacancy.externalId}`
        })
      })
      .from(vacancy)
      .leftJoin(employer, sql`${employer.id} = ${vacancy.employerId}`)
      .where(where)
      .orderBy(sql`${vacancy.publishedAt} desc nulls last`)
      .limit(10)

    return {
      count: Number((countRows.rows[0] as { count?: number | string } | undefined)?.count ?? 0),
      keywords: facetRows(keywordRows.rows as ReadonlyArray<Record<string, unknown>>),
      skills: facetRows(skillRows.rows as ReadonlyArray<Record<string, unknown>>),
      companies: (companyRows.rows as ReadonlyArray<Record<string, unknown>>).map((row) => ({
        id: String(row.id) as PresetPreview["companies"][number]["id"],
        name: String(row.name),
        count: Number(row.count ?? 0)
      })),
      vacancies: (vacancyRows as unknown as ReadonlyArray<Parameters<typeof VacancyRepository.toSummary>[0]>)
        .map(VacancyRepository.toSummary)
    }
  })

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

/**
 * Creates or refreshes a system preset (`user_id` null, everyone reads it,
 * only the owner writes). Keyed by kind and title, so a restart converges to
 * the filter in code instead of piling up copies.
 */
export const ensureSystem = (
  tx: Executor,
  input: {
    readonly kind: "explore" | "apply"
    readonly title: string
    readonly filter: PresetFilter
  }
): RepoEffect<PresetRecord> =>
  Effect.gen(function*() {
    const filter = input.filter as Record<string, unknown>
    const [updated] = yield* tx
      .update(preset)
      .set({ filter, updatedAt: new Date() })
      .where(
        sql`${preset.userId} is null and ${preset.system} and ${preset.kind} = ${input.kind} and ${preset.title} = ${input.title}`
      )
      .returning()
    if (updated !== undefined) return toRecord(updated)

    const [row] = yield* tx
      .insert(preset)
      .values({ userId: null, kind: input.kind, title: input.title, filter, system: true })
      .returning()
    return toRecord(row!)
  })
