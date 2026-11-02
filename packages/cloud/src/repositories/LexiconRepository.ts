import type { LexiconKeyword } from "@otbor/contract"
import type { LexiconEntryInput, LexiconMatch } from "@otbor/domain"
import { normalizeTerm } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { keyword, keywordAlias, vacancyKeyword } from "../db/tables.ts"

interface Entry {
  readonly id: string
  readonly term: string
  readonly normalizedTerm: string
  readonly enabled: boolean
  aliases: Array<{ id: string; alias: string; normalizedAlias: string; typo: boolean }>
}

export const loadEntries = (tx: Executor): RepoEffect<ReadonlyArray<LexiconEntryInput>> =>
  Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select k.id, k.term, k.normalized_term, k.enabled,
             a.id as alias_id, a.alias, a.normalized_alias, a.typo
      from keyword k
      left join keyword_alias a on a.keyword_id = k.id
      order by k.term, a.alias
    `)

    const entries = new Map<string, Entry>()

    for (const raw of rows.rows as unknown as ReadonlyArray<{
      id: string
      term: string
      normalized_term: string
      enabled: boolean
      alias_id: string | null
      alias: string | null
      normalized_alias: string | null
      typo: boolean | null
    }>) {
      let entry = entries.get(raw.id)
      if (entry === undefined) {
        entry = {
          id: raw.id,
          term: raw.term,
          normalizedTerm: raw.normalized_term,
          enabled: raw.enabled,
          aliases: []
        }
        entries.set(raw.id, entry)
      }
      if (raw.alias_id !== null && raw.alias !== null && raw.normalized_alias !== null) {
        entry.aliases.push({
          id: raw.alias_id,
          alias: raw.alias,
          normalizedAlias: raw.normalized_alias,
          typo: raw.typo ?? false
        })
      }
    }

    return [...entries.values()]
  })

const toRecord = (entry: {
  id: string
  term: string
  normalizedTerm: string
  enabled: boolean
  aliases: ReadonlyArray<{ id: string; alias: string; normalizedAlias: string; typo: boolean }>
}): LexiconKeyword => ({
  id: entry.id as LexiconKeyword["id"],
  term: entry.term,
  normalizedTerm: entry.normalizedTerm,
  enabled: entry.enabled,
  aliases: entry.aliases.map((alias) => ({
    id: alias.id as LexiconKeyword["aliases"][number]["id"],
    alias: alias.alias,
    normalizedAlias: alias.normalizedAlias,
    typo: alias.typo,
    matchType: "word"
  }))
})

export const list = (
  tx: Executor,
  options: { readonly query?: string; readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<LexiconKeyword>> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000)
    const pattern = options.query === undefined || options.query.trim() === ""
      ? null
      : `%${normalizeTerm(options.query)}%`

    const rows = yield* tx.execute(sql`
      select k.id, k.term, k.normalized_term, k.enabled,
             a.id as alias_id, a.alias, a.normalized_alias, a.typo
      from keyword k
      left join keyword_alias a on a.keyword_id = k.id
      where ${pattern === null
        ? sql`true`
        : sql`(k.normalized_term like ${pattern} or a.normalized_alias like ${pattern})`}
      order by k.term, a.alias
      limit ${limit}
    `)

    const entries = new Map<string, Entry>()
    for (const raw of rows.rows as unknown as ReadonlyArray<{
      id: string
      term: string
      normalized_term: string
      enabled: boolean
      alias_id: string | null
      alias: string | null
      normalized_alias: string | null
      typo: boolean | null
    }>) {
      let entry = entries.get(raw.id)
      if (entry === undefined) {
        entry = {
          id: raw.id,
          term: raw.term,
          normalizedTerm: raw.normalized_term,
          enabled: raw.enabled,
          aliases: []
        }
        entries.set(raw.id, entry)
      }
      if (raw.alias_id !== null && raw.alias !== null && raw.normalized_alias !== null) {
        entry.aliases.push({
          id: raw.alias_id,
          alias: raw.alias,
          normalizedAlias: raw.normalized_alias,
          typo: raw.typo ?? false
        })
      }
    }

    return [...entries.values()].map(toRecord)
  })

export interface UpsertKeywordInput {
  readonly term: string
  readonly aliases?: ReadonlyArray<string>
  readonly enabled?: boolean
}

export const upsert = (
  tx: Executor,
  input: UpsertKeywordInput
): RepoEffect<LexiconKeyword> =>
  Effect.gen(function*() {
    const normalized = normalizeTerm(input.term)
    const [row] = yield* tx
      .insert(keyword)
      .values({ term: input.term.trim(), normalizedTerm: normalized, enabled: input.enabled ?? true })
      .onConflictDoUpdate({
        target: keyword.normalizedTerm,
        set: {
          term: sql`excluded.term`,
          enabled: sql`excluded.enabled`,
          updatedAt: sql`now()`
        }
      })
      .returning({ id: keyword.id, term: keyword.term, normalizedTerm: keyword.normalizedTerm, enabled: keyword.enabled })

    const keywordId = row!.id
    const aliases = [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0))]
    const normalizedAliases = aliases.map(normalizeTerm).filter((alias) => alias !== normalized)

    if (normalizedAliases.length > 0) {
      yield* tx
        .insert(keywordAlias)
        .values(
          normalizedAliases.map((alias, index) => ({
            keywordId,
            alias: aliases[index]!,
            normalizedAlias: alias
          }))
        )
        .onConflictDoUpdate({
          target: [keywordAlias.keywordId, keywordAlias.normalizedAlias],
          set: { alias: sql`excluded.alias` }
        })

      const keep = sql.join(normalizedAliases.map((alias) => sql`${alias}`), sql`, `)
      yield* tx.execute(sql`
        delete from keyword_alias
        where keyword_id = ${keywordId}
          and normalized_alias not in (${keep})
      `)
    } else {
      yield* tx.delete(keywordAlias).where(sql`${keywordAlias.keywordId} = ${keywordId}`)
    }

    const entries = yield* list(tx, { query: input.term, limit: 1 })
    const updated = entries.find((entry) => entry.id === keywordId)
    return updated ?? toRecord({ ...row!, aliases: [] })
  })

export const remove = (tx: Executor, id: string): RepoEffect<boolean> =>
  tx
    .delete(keyword)
    .where(sql`${keyword.id} = ${id}`)
    .returning({ id: keyword.id })
    .pipe(Effect.map((rows) => rows.length > 0))

/**
 * Rewrites the matches of one vacancy. Matches are derived data: recomputing
 * them on every ingest is cheaper and more honest than diffing forms.
 */
export const replaceMatches = (
  tx: Executor,
  vacancyId: string,
  matches: ReadonlyArray<LexiconMatch>
): RepoEffect<void> =>
  Effect.gen(function*() {
    yield* tx.delete(vacancyKeyword).where(sql`${vacancyKeyword.vacancyId} = ${vacancyId}`)
    if (matches.length === 0) return

    yield* tx.insert(vacancyKeyword).values(
      matches.map((match) => ({
        vacancyId,
        keywordId: match.keywordId,
        aliasId: match.aliasId,
        matchedForm: match.matchedForm,
        inTitle: match.inTitle,
        titleCount: match.titleCount,
        inBody: match.inBody,
        bodyCount: match.bodyCount,
        inSkills: match.inSkills,
        typo: match.typo
      }))
    )
  })

export interface StoredMatch {
  readonly keywordId: string
  readonly term: string
  readonly aliasId: string | null
  readonly matchedForm: string
  readonly typo: boolean
  readonly inTitle: boolean
  readonly titleCount: number
  readonly inBody: boolean
  readonly bodyCount: number
  readonly inSkills: boolean
}

export const matchesFor = (tx: Executor, vacancyId: string): RepoEffect<ReadonlyArray<StoredMatch>> =>
  tx
    .execute(sql`
      select vk.keyword_id, k.term, vk.alias_id, vk.matched_form, vk.typo,
             vk.in_title, vk.title_count, vk.in_body, vk.body_count, vk.in_skills
      from vacancy_keyword vk
      join keyword k on k.id = vk.keyword_id
      where vk.vacancy_id = ${vacancyId}
      order by k.term, vk.matched_form
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{
          keyword_id: string
          term: string
          alias_id: string | null
          matched_form: string
          typo: boolean
          in_title: boolean
          title_count: number
          in_body: boolean
          body_count: number
          in_skills: boolean
        }>).map((row) => ({
          keywordId: row.keyword_id,
          term: row.term,
          aliasId: row.alias_id,
          matchedForm: row.matched_form,
          typo: row.typo,
          inTitle: row.in_title,
          titleCount: row.title_count,
          inBody: row.in_body,
          bodyCount: row.body_count,
          inSkills: row.in_skills
        }))
      )
    )

/** Bulk seed: batched inserts, no per-term round trips and no alias deletion. */
export const seed = (
  tx: Executor,
  entries: ReadonlyArray<{ readonly term: string; readonly aliases: ReadonlyArray<string> }>
): RepoEffect<number> =>
  Effect.gen(function*() {
    const normalized = new Map<string, string>()
    for (const entry of entries) {
      const term = entry.term.trim()
      if (term.length === 0) continue
      normalized.set(normalizeTerm(term), term)
    }

    const terms = [...normalized.entries()].map(([normalizedTerm, term]) => ({
      term,
      normalizedTerm
    }))

    const chunkSize = 500
    for (let index = 0; index < terms.length; index += chunkSize) {
      yield* tx
        .insert(keyword)
        .values(terms.slice(index, index + chunkSize))
        .onConflictDoNothing({ target: keyword.normalizedTerm })
    }

    const rows = yield* tx
      .select({ id: keyword.id, normalizedTerm: keyword.normalizedTerm })
      .from(keyword)
    const ids = new Map(rows.map((row) => [row.normalizedTerm, row.id]))

    const aliasRows: Array<{
      keywordId: string
      alias: string
      normalizedAlias: string
    }> = []
    const seen = new Set<string>()

    for (const entry of entries) {
      const keywordId = ids.get(normalizeTerm(entry.term))
      if (keywordId === undefined) continue
      for (const raw of entry.aliases) {
        const alias = raw.trim()
        if (alias.length === 0) continue
        const normalizedAlias = normalizeTerm(alias)
        const key = `${keywordId}\u0000${normalizedAlias}`
        if (normalizedAlias === normalizeTerm(entry.term) || seen.has(key)) continue
        seen.add(key)
        aliasRows.push({ keywordId, alias, normalizedAlias })
      }
    }

    for (let index = 0; index < aliasRows.length; index += chunkSize) {
      yield* tx
        .insert(keywordAlias)
        .values(aliasRows.slice(index, index + chunkSize))
        .onConflictDoNothing()
    }

    return terms.length
  })
