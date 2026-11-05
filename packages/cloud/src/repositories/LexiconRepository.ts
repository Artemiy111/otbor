import type { LexiconKeyword, PresetFilter, PresetRule } from "@otbor/contract"
import { expandAreaIds } from "@otbor/contract/areas"
import type { LexiconEntryInput, LexiconMatch } from "@otbor/domain"
import {
  ANALYSIS_PROMPT_VERSION,
  describeGroup,
  describeRule,
  matchLexicon,
  normalizeTerm
} from "@otbor/domain"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { keyword, keywordAlias, vacancyKeyword } from "../db/tables.ts"
import * as BlacklistRepository from "./BlacklistRepository.ts"

interface AliasStat {
  alias: string
  normalizedAlias: string
  typo: boolean
  vacancies: number
  mentions: number
  share: number
}

interface Entry {
  readonly id: string
  readonly term: string
  readonly normalizedTerm: string
  readonly vacancyCount: number
  skillVacancyCount: number
  resumeAccountIds: Array<string>
  resumeSkillAccountIds: Array<string>
  resumeIds: Array<string>
  resumeSkillIds: Array<string>
  aliases: Array<{ id: string; alias: string; normalizedAlias: string; typo: boolean }>
  aliasStats: Array<AliasStat>
}

/** Escapes the LIKE wildcards so a preset's text is a literal substring. */
export const likePattern = (text: string): string =>
  `%${text.trim().replace(/[\\%_]/g, "\\$&")}%`

/**
 * Which match row counts for a keyword location. `any` is no constraint;
 * `text_or_skills` is the union the operator sees as "в тексте или навыках".
 */
const locationSql = (
  location: PresetFilter["location"],
  alias: "vk" | "vk_filter"
): SQL | null => {
  switch (location) {
    case "title":
      return sql.raw(`${alias}.in_title`)
    case "body":
      return sql.raw(`${alias}.in_body`)
    case "skills":
      return sql.raw(`${alias}.in_skills`)
    case "text_or_skills":
      return sql.raw(`(${alias}.in_body or ${alias}.in_skills)`)
    default:
      return null
  }
}

const textPattern = (value: unknown): string =>
  `%${String(value).trim().replace(/[\\%_]/g, "\\$&")}%`

const numberValue = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const textValue = (value: unknown): string => String(value ?? "").trim()

const stringList = (value: unknown): ReadonlyArray<string> => {
  if (Array.isArray(value)) return value.map((item) => String(item))
  const single = textValue(value)
  return single === "" ? [] : [single]
}

/** A rule value as a JSONB array for `work_formats @> ...`. */
const jsonArrayList = (values: ReadonlyArray<string>): SQL =>
  sql`${JSON.stringify(values)}::jsonb`

const textFieldSql = (field: PresetRule["field"]): SQL | null => {
  switch (field) {
    case "title":
      return sql`vacancy.title`
    case "description":
      return sql`coalesce(vacancy.description_text, '')`
    case "employer":
      return sql`(select e.name from employer e where e.id = vacancy.employer_id)`
    case "area":
      return sql`coalesce(vacancy.area_name, '')`
    case "salary_currency":
      return sql`coalesce(vacancy.salary_currency, '')`
    case "seniority":
      return sql`vacancy.seniority`
    case "experience":
      return sql`coalesce(vacancy.experience_code, '')`
    case "employment_form":
      return sql`coalesce(vacancy.employment_form, '')`
    case "source":
      return sql`vacancy.source`
    // Facts below the model's threshold are stored as null, so they read as ''.
    case "analysis_role":
      return sql`coalesce((select a.facts->'role'->>'value' from vacancy_analysis a where a.vacancy_id = vacancy.id and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}), '')`
    case "analysis_level":
      return sql`coalesce((select a.facts->'requiredLevel'->>'value' from vacancy_analysis a where a.vacancy_id = vacancy.id and a.prompt_version = ${ANALYSIS_PROMPT_VERSION}), '')`
    default:
      return null
  }
}

const numberFieldSql = (field: PresetRule["field"]): SQL | null => {
  switch (field) {
    case "salary_from":
      return sql`vacancy.salary_from`
    case "salary_to":
      return sql`vacancy.salary_to`
    case "responses_total":
      return sql`vacancy.responses_total`
    case "description_length":
      return sql`length(coalesce(vacancy.description_text, ''))`
    case "skills_count":
      return sql`(select count(*)::int from vacancy_skill vs where vs.vacancy_id = vacancy.id)`
    case "employer_vacancies":
      return sql`(select count(*)::int from vacancy v_emp where v_emp.employer_id = vacancy.employer_id and not v_emp.archived)`
    case "employer_rating":
      return sql`(select e_r.rating from employer e_r where e_r.id = vacancy.employer_id)`
    case "employer_reviews":
      return sql`(select e_r.reviews_count from employer e_r where e_r.id = vacancy.employer_id)`
    default:
      return null
  }
}

const ruleClause = (rule: PresetRule, filter: PresetFilter, context: VacancyFilterContext = {}): SQL => {
  const op = rule.op
  const value = rule.value

  if (rule.field === "archived") {
    return op === "is_true" ? sql`vacancy.archived` : sql`not vacancy.archived`
  }

  if (rule.field === "hidden") {
    const hidden = BlacklistRepository.hiddenBySelectorsSql({
      userId: context.userId,
      selectors: stringList(value),
      employerExternalId: sql`(select e_h.external_id from employer e_h where e_h.id = vacancy.employer_id)`,
      vacancyExternalId: sql`vacancy.external_id`
    })
    return op === "not_in" || op === "neq" ? sql`not (${hidden})` : hidden
  }

  if (rule.field === "salary") {
    const amount = numberValue(value)
    const low = sql`coalesce(vacancy.salary_from, vacancy.salary_to)`
    const high = sql`coalesce(vacancy.salary_to, vacancy.salary_from)`
    const compare = (() => {
      switch (op) {
        case "gt":
          return sql`${high} > ${amount}`
        case "gte":
          return sql`${high} >= ${amount}`
        case "lt":
          return sql`${low} < ${amount}`
        case "lte":
          return sql`${low} <= ${amount}`
        case "neq":
          return sql`not (${low} <= ${amount} and ${high} >= ${amount})`
        default:
          return sql`(${low} <= ${amount} and ${high} >= ${amount})`
      }
    })()
    const currency = rule.currency?.trim() ?? ""
    const stated = currency === ""
      ? compare
      : sql`(${compare} and vacancy.salary_currency = ${currency})`
    return rule.orMissing === true
      ? sql`(${stated} or (vacancy.salary_from is null and vacancy.salary_to is null))`
      : stated
  }

  if (rule.field === "location") {
    // Values are hh area ids; a country or region stands for everything below
    // it. One JSON parameter keeps a whole country (thousands of ids) well
    // under the bind-parameter limit. A vacancy without an area is in no place.
    const ids = expandAreaIds(
      stringList(value).map(Number).filter((id) => Number.isInteger(id) && id > 0)
    )
    if (ids.length === 0) return sql`true`
    const inside = sql`coalesce(vacancy.area_id in (select (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::int), false)`
    return op === "not_in" || op === "neq" ? sql`not ${inside}` : inside
  }

  if (rule.field === "published_days") {
    return sql`vacancy.published_at >= now() - make_interval(days => ${numberValue(value)})`
  }

  if (rule.field === "skills") {
    if (op === "in" || op === "not_in") {
      const terms = stringList(value).map((term) => term.trim()).filter(Boolean)
      if (terms.length === 0) return sql`true`
      const pattern = sql.join(terms.map((term) => sql`${textPattern(term)}`), sql`, `)
      const exists = sql`exists (
        select 1 from vacancy_skill vs
        where vs.vacancy_id = vacancy.id and vs.normalized_term ilike any (array[${pattern}])
      )`
      return op === "not_in" ? sql`not (${exists})` : exists
    }
    const pattern = textPattern(value)
    const exists = sql`exists (
      select 1 from vacancy_skill vs
      where vs.vacancy_id = vacancy.id and vs.normalized_term ilike ${pattern}
    )`
    return op === "not_contains" ? sql`not (${exists})` : exists
  }

  if (rule.field === "keywords") {
    const location = locationSql(filter.location, "vk")
    const locationFilter = location === null ? sql`` : sql`and ${location}`

    if (op === "in" || op === "not_in") {
      const terms = stringList(value)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
      if (terms.length === 0) return sql`true`
      const list = sql.join(terms.map((term) => sql`${term}`), sql`, `)
      const exists = sql`exists (
        select 1
        from vacancy_keyword vk
        join keyword k on k.id = vk.keyword_id
        where vk.vacancy_id = vacancy.id
          and k.normalized_term in (${list})
          ${locationFilter}
      )`
      return op === "not_in" ? sql`not (${exists})` : exists
    }

    const pattern = textPattern(value)
    const exists = sql`exists (
      select 1
      from vacancy_keyword vk
      join keyword k on k.id = vk.keyword_id
      where vk.vacancy_id = vacancy.id
        and (k.normalized_term ilike ${pattern})
        ${locationFilter}
    )`
    return op === "not_contains" ? sql`not (${exists})` : exists
  }

  if (rule.field === "work_format") {
    const formats = stringList(value).map((format) => format.trim()).filter(Boolean)
    if (formats.length === 0) return sql`true`
    const formula = sql`vacancy.work_formats @> ${jsonArrayList(formats)}`
    return op === "not_in" || op === "neq" ? sql`not (${formula})` : formula
  }

  const textField = textFieldSql(rule.field)
  if (textField !== null) {
    if (op === "contains_any" || op === "not_contains_any") {
      const patterns = stringList(value).map((item) => item.trim()).filter(Boolean).map(textPattern)
      if (patterns.length === 0) return sql`true`
      const any = sql`${textField} ilike any (array[${sql.join(patterns.map((pattern) => sql`${pattern}`), sql`, `)}])`
      return op === "not_contains_any" ? sql`not coalesce(${any}, false)` : any
    }
    if (op === "contains") {
      return sql`${textField} ilike ${textPattern(value)}`
    }
    if (op === "not_contains") {
      return sql`${textField} not ilike ${textPattern(value)}`
    }
    if (op === "in" || op === "not_in") {
      const values = stringList(value).map((item) => item.trim()).filter(Boolean)
      if (values.length === 0) return sql`true`
      const list = sql.join(values.map((item) => sql`${item}`), sql`, `)
      return op === "not_in"
        ? sql`${textField} not in (${list})`
        : sql`${textField} in (${list})`
    }
    return op === "neq"
      ? sql`${textField} <> ${textValue(value)}`
      : sql`${textField} = ${textValue(value)}`
  }

  const numberField = numberFieldSql(rule.field)
  if (numberField !== null) {
    const numeric = numberValue(value)
    if (op === "gte") return sql`${numberField} >= ${numeric}`
    if (op === "gt") return sql`${numberField} > ${numeric}`
    if (op === "lt") return sql`${numberField} < ${numeric}`
    if (op === "lte") return sql`${numberField} <= ${numeric}`
    return op === "neq" ? sql`${numberField} <> ${numeric}` : sql`${numberField} = ${numeric}`
  }

  return sql`true`
}

/**
 * The vacancy predicate shared by the keyword count and the "has matching
 * vacancies" filter. `vacancy` is in scope in both correlated subqueries.
 */
export interface VacancyFilterContext {
  /** Enables the default app-layer blacklist exclusion for presets. */
  readonly userId?: string
}

/** One AND clause of a filter with a readable name, as `vacancyFilterSql` joins them. */
interface FilterPart {
  readonly label: string
  readonly clause: SQL
  /** Which listed substrings matched (a text), so a failed `not_contains_any` can name them. */
  readonly hits?: SQL
  readonly hitsLabel?: string
}

/** The listed substrings of a `*_contains_any` rule that the text contains, comma separated. */
const listHitsSql = (rule: PresetRule): SQL | undefined => {
  if (rule.op !== "not_contains_any") return undefined
  const field = textFieldSql(rule.field)
  if (field === null) return undefined
  const items = stringList(rule.value).map((item) => item.trim()).filter(Boolean)
  if (items.length === 0) return undefined
  const itemList = sql.join(items.map((item) => sql`${item}`), sql`, `)
  const patternList = sql.join(items.map((item) => sql`${textPattern(item)}`), sql`, `)
  return sql`(select string_agg(t.item, ', ') from unnest(array[${itemList}]::text[], array[${patternList}]::text[]) as t(item, pattern) where ${field} ilike t.pattern)`
}

/**
 * The clauses of a filter in evaluation order: the implicit ones
 * (archived, app blacklist, legacy `text`), every rule, every OR group.
 * `vacancyFilterSql` ANDs them; `evaluateFilter` reports each separately.
 */
const filterParts = (
  filter: PresetFilter,
  context: VacancyFilterContext
): ReadonlyArray<FilterPart> => {
  const parts: Array<FilterPart> = []

  const hasArchivedRule = [
    ...(filter.rules ?? []),
    ...(filter.groups ?? []).flatMap((group) => group.branches.flatMap((branch) => branch.rules))
  ].some((rule) => rule.field === "archived")
  if (filter.includeArchived !== true && !hasArchivedRule) {
    parts.push({ label: "not archived", clause: sql`not vacancy.archived` })
  }

  // A preset hides app-level blacklisted companies unless it opts in. Account
  // and hh-native layers stay out of a shared preset preview.
  if (filter.includeBlacklisted !== true && context.userId !== undefined) {
    parts.push({
      label: "not blacklisted",
      clause: sql`not ${BlacklistRepository.appBlacklistExistsSql({
        userId: context.userId,
        employerExternalId: sql`(select e_bl.external_id from employer e_bl where e_bl.id = vacancy.employer_id)`,
        vacancyExternalId: sql`vacancy.external_id`
      })}`
    })
  }

  const text = filter.text?.trim()
  if (text !== undefined && text !== "") {
    parts.push({
      label: `title contains ${text}`,
      clause: sql`vacancy.title ilike ${likePattern(text)}`
    })
  }

  for (const rule of filter.rules ?? []) {
    parts.push({ label: describeRule(rule), clause: ruleClause(rule, filter, context), hits: listHitsSql(rule), hitsLabel: `${rule.field} not_contains_any` })
  }

  for (const group of filter.groups ?? []) {
    const branches = group.branches
      .filter((branch) => branch.rules.length > 0)
      .map((branch) => sql`(${sql.join(branch.rules.map((rule) => ruleClause(rule, filter, context)), sql` and `)})`)
    if (branches.length > 0) {
      parts.push({ label: describeGroup(group), clause: sql`(${sql.join(branches, sql` or `)})` })
    }
  }

  return parts
}

export const vacancyFilterSql = (
  filter: PresetFilter,
  context: VacancyFilterContext = {}
): SQL =>
  sql.join([sql`true`, ...filterParts(filter, context).map((part) => part.clause)], sql` and `)

/**
 * Evaluates a filter against one vacancy with the very SQL search uses: one
 * query, one boolean per clause. `failed` names every clause that did not
 * hold, so a skip can say which rules cost the vacancy. A missing vacancy
 * fails. `includeBlacklisted` lifts the app blacklist exclusion like the
 * filter's own flag does.
 */
export const evaluateFilter = (
  tx: Executor,
  filter: PresetFilter,
  vacancyId: string,
  context: VacancyFilterContext & { readonly includeBlacklisted?: boolean } = {}
): RepoEffect<{ readonly passed: boolean; readonly failed: ReadonlyArray<string> }> =>
  Effect.gen(function*() {
    const effective: PresetFilter = context.includeBlacklisted === true
      ? { ...filter, includeBlacklisted: true }
      : filter
    const parts = filterParts(effective, context)
    if (parts.length === 0) return { passed: true, failed: [] }

    const columns = sql.join(
      parts.flatMap((part, index) => [
        sql`coalesce(${part.clause}, false) as ${sql.raw(`c${index}`)}`,
        ...(part.hits === undefined ? [] : [sql`${part.hits} as ${sql.raw(`h${index}`)}`])
      ]),
      sql`, `
    )
    const result = yield* tx.execute(sql`
      select ${columns} from vacancy where vacancy.id = ${vacancyId}
    `)
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (row === undefined) return { passed: false, failed: ["vacancy not found"] }

    // A failed "contains none of" rule names the substrings that matched, not
    // the whole list.
    const failed = parts.flatMap((part, index) => {
      if (row[`c${index}`] === true) return []
      const hits = row[`h${index}`]
      return typeof hits === "string" && hits !== "" && part.hitsLabel !== undefined
        ? [`${part.hitsLabel} ${hits}`]
        : [part.label]
    })
    return { passed: failed.length === 0, failed }
  })

const vacancyCountSql = (
  filter: PresetFilter,
  keywordId: SQL,
  context: VacancyFilterContext
): SQL => {
  const location = locationSql(filter.location, "vk")
  return sql`(
    select count(distinct vk.vacancy_id)::int
    from vacancy_keyword vk
    join vacancy on vacancy.id = vk.vacancy_id
    where vk.keyword_id = ${keywordId}
      and ${vacancyFilterSql(filter, context)}
      ${location === null ? sql`` : sql`and ${location}`}
  )`
}

/** Vacancies where hh itself lists the keyword as a skill; ignores the location filter. */
const skillCountSql = (
  filter: PresetFilter,
  keywordId: SQL,
  context: VacancyFilterContext
): SQL => sql`(
    select count(distinct vk.vacancy_id)::int
    from vacancy_keyword vk
    join vacancy on vacancy.id = vk.vacancy_id
    where vk.keyword_id = ${keywordId}
      and vk.in_skills
      and ${vacancyFilterSql(filter, context)}
  )`

export const loadEntries = (tx: Executor): RepoEffect<ReadonlyArray<LexiconEntryInput>> =>
  Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select k.id, k.term, k.normalized_term,
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
          vacancyCount: 0,
          skillVacancyCount: 0,
          resumeAccountIds: [],
          resumeSkillAccountIds: [],
          resumeIds: [],
          resumeSkillIds: [],
          aliases: [],
          aliasStats: [],
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
  vacancyCount: number
  skillVacancyCount?: number
  resumeAccountIds?: ReadonlyArray<string>
  resumeSkillAccountIds?: ReadonlyArray<string>
  resumeIds?: ReadonlyArray<string>
  resumeSkillIds?: ReadonlyArray<string>
  aliases: ReadonlyArray<{ id: string; alias: string; normalizedAlias: string; typo: boolean }>
  aliasStats?: ReadonlyArray<AliasStat>
}): LexiconKeyword => ({
  id: entry.id as LexiconKeyword["id"],
  term: entry.term,
  normalizedTerm: entry.normalizedTerm,
  vacancyCount: entry.vacancyCount,
  skillVacancyCount: entry.skillVacancyCount ?? 0,
  resumeAccountIds: (entry.resumeAccountIds ?? []) as LexiconKeyword["resumeAccountIds"],
  resumeSkillAccountIds: (entry.resumeSkillAccountIds ?? []) as LexiconKeyword["resumeSkillAccountIds"],
  resumeIds: (entry.resumeIds ?? []) as LexiconKeyword["resumeIds"],
  resumeSkillIds: (entry.resumeSkillIds ?? []) as LexiconKeyword["resumeSkillIds"],
  aliases: entry.aliases.map((alias) => ({
    id: alias.id as LexiconKeyword["aliases"][number]["id"],
    alias: alias.alias,
    normalizedAlias: alias.normalizedAlias,
    typo: alias.typo,
    matchType: "word"
  })),
  aliasStats: (entry.aliasStats ?? []).map((stat) => ({
    alias: stat.alias,
    normalizedAlias: stat.normalizedAlias,
    typo: stat.typo,
    vacancies: stat.vacancies,
    mentions: stat.mentions,
    share: stat.share
  }))
})

export interface LexiconListOptions {
  readonly query?: string
  readonly limit?: number
  /**
   * When present, the returned keywords and their counts describe the
   * vacancies this filter selects. Without it every keyword is returned and
   * `vacancyCount` still counts active vacancies.
   */
  readonly filter?: PresetFilter
  /** The preset's owner; enables the app-layer blacklist default. */
  readonly userId?: string
}

export const list = (
  tx: Executor,
  options: LexiconListOptions = {}
): RepoEffect<ReadonlyArray<LexiconKeyword>> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 5000)
    const pattern = options.query === undefined || options.query.trim() === ""
      ? null
      : `%${normalizeTerm(options.query)}%`

    const filter = options.filter ?? {}
    const context = { userId: options.userId }
    const ids = filter.keywordIds ?? []
    const keywordClause = ids.length === 0
      ? sql`true`
      : sql`k.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`

    // A preset narrows the keyword list to keywords that appear in at least
    // one vacancy the filter selects. The count uses its own correlated
    // subquery, so the alias join below cannot inflate it.
    const presetClause = options.filter === undefined
      ? sql`true`
      : (() => {
          const locationFilter = locationSql(filter.location, "vk_filter")
          return sql`exists (
            select 1
            from vacancy_keyword vk_filter
            join vacancy on vacancy.id = vk_filter.vacancy_id
            where vk_filter.keyword_id = k.id
              and ${vacancyFilterSql(filter, context)}
              ${locationFilter === null ? sql`` : sql`and ${locationFilter}`}
          )`
        })()

    const rows = yield* tx.execute(sql`
      with matching as (
        select k.id, k.term, k.normalized_term
        from keyword k
        where ${pattern === null
          ? sql`true`
          : sql`(k.normalized_term like ${pattern} or exists (
              select 1 from keyword_alias a
              where a.keyword_id = k.id and a.normalized_alias like ${pattern}
            ))`}
          and ${keywordClause}
          and ${presetClause}
        order by k.term
        limit ${limit}
      )
      select matching.id, matching.term, matching.normalized_term,
             a.id as alias_id, a.alias, a.normalized_alias, a.typo,
             ${vacancyCountSql(filter, sql`matching.id`, context)} as vacancy_count,
             ${skillCountSql(filter, sql`matching.id`, context)} as skill_count
      from matching
      left join keyword_alias a on a.keyword_id = matching.id
      order by matching.term, a.alias
    `)

    const entries = new Map<string, Entry>()
    for (const raw of rows.rows as unknown as ReadonlyArray<{
      id: string
      term: string
      normalized_term: string
      alias_id: string | null
      alias: string | null
      normalized_alias: string | null
      typo: boolean | null
      vacancy_count: number | string | null
      skill_count: number | string | null
    }>) {
      let entry = entries.get(raw.id)
      if (entry === undefined) {
        entry = {
          id: raw.id,
          term: raw.term,
          normalizedTerm: raw.normalized_term,
          vacancyCount: Number(raw.vacancy_count ?? 0),
          skillVacancyCount: Number(raw.skill_count ?? 0),
          resumeAccountIds: [],
          resumeSkillAccountIds: [],
          resumeIds: [],
          resumeSkillIds: [],
          aliases: [],
          aliasStats: []
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

    const keywordIds = [...entries.keys()]
    if (keywordIds.length > 0) {
      const location = locationSql(filter.location, "vk")
      const statsResult = yield* tx.execute(sql`
        select vk.keyword_id,
               vk.alias_id,
               vk.matched_form,
               vk.typo,
               coalesce(ka.alias, vk.matched_form) as alias_text,
               coalesce(ka.normalized_alias, vk.matched_form) as normalized_alias_text,
               count(distinct vk.vacancy_id)::int as vacancies,
               coalesce(sum(vk.title_count + vk.body_count), 0)::int as mentions
        from vacancy_keyword vk
        join vacancy on vacancy.id = vk.vacancy_id
        left join keyword_alias ka on ka.id = vk.alias_id
        where vk.keyword_id in (${sql.join(keywordIds.map((id) => sql`${id}`), sql`, `)})
          and ${vacancyFilterSql(filter, context)}
          ${location === null ? sql`` : sql`and ${location}`}
        group by vk.keyword_id, vk.alias_id, vk.matched_form, vk.typo, ka.alias, ka.normalized_alias
      `)

      const grouped = new Map<string, Array<{
        alias: string
        normalizedAlias: string
        typo: boolean
        vacancies: number
        mentions: number
      }>>()

      for (const raw of statsResult.rows as unknown as ReadonlyArray<{
        keyword_id: string
        alias_text: string | null
        normalized_alias_text: string | null
        typo: boolean | null
        vacancies: number | string | null
        mentions: number | string | null
      }>) {
        const list = grouped.get(raw.keyword_id) ?? []
        grouped.set(raw.keyword_id, list)
        list.push({
          alias: textValue(raw.alias_text),
          normalizedAlias: textValue(raw.normalized_alias_text),
          typo: raw.typo ?? false,
          vacancies: numberValue(raw.vacancies),
          mentions: numberValue(raw.mentions)
        })
      }

      for (const [keywordId, entry] of entries) {
        const stats = grouped.get(keywordId) ?? []
        const total = stats.reduce((sum, stat) => sum + stat.mentions, 0)
        const withShare = stats
          .map((stat) => ({
            ...stat,
            share: total === 0 ? 0 : Math.round((stat.mentions / total) * 100)
          }))
          .sort((a, b) => b.mentions - a.mentions)
        entry.aliasStats = withShare
      }
    }

    if (entries.size > 0) {
      const resumes = yield* tx.execute(sql`
        select id, hh_account_id, title, text, about, skills from resume
      `)
      const lexicon: ReadonlyArray<LexiconEntryInput> = [...entries.values()].map((entry) => ({
        id: entry.id,
        term: entry.term,
        normalizedTerm: entry.normalizedTerm,
        aliases: entry.aliases
      }))
      for (const raw of resumes.rows as unknown as ReadonlyArray<{
        id: string
        hh_account_id: string
        title: string
        text: string
        about: string
        skills: ReadonlyArray<string> | null
      }>) {
        const matches = matchLexicon(lexicon, {
          title: raw.title,
          body: `${raw.text}\n${raw.about}`,
          skills: raw.skills ?? []
        })
        for (const match of matches) {
          const entry = entries.get(match.keywordId)
          if (entry === undefined) continue
          if (
            (match.inTitle || match.inBody) &&
            !entry.resumeAccountIds.includes(raw.hh_account_id)
          ) {
            entry.resumeAccountIds.push(raw.hh_account_id)
          }
          if ((match.inTitle || match.inBody) && !entry.resumeIds.includes(raw.id)) {
            entry.resumeIds.push(raw.id)
          }
          if (match.inSkills && !entry.resumeSkillIds.includes(raw.id)) {
            entry.resumeSkillIds.push(raw.id)
          }
          if (match.inSkills && !entry.resumeSkillAccountIds.includes(raw.hh_account_id)) {
            entry.resumeSkillAccountIds.push(raw.hh_account_id)
          }
        }
      }
    }

    return [...entries.values()].map(toRecord)
  })

export interface UpsertKeywordInput {
  /** When set, this row is renamed/edited instead of matched by term. */
  readonly id?: string
  readonly term: string
  readonly aliases?: ReadonlyArray<string>
}

export const upsert = (
  tx: Executor,
  input: UpsertKeywordInput
): RepoEffect<LexiconKeyword> =>
  Effect.gen(function*() {
    const normalized = normalizeTerm(input.term)
    const [row] = input.id !== undefined
      ? yield* tx
        .update(keyword)
        .set({ term: input.term.trim(), normalizedTerm: normalized, updatedAt: sql`now()` })
        .where(sql`${keyword.id} = ${input.id}`)
        .returning({ id: keyword.id, term: keyword.term, normalizedTerm: keyword.normalizedTerm })
      : yield* tx
        .insert(keyword)
        .values({ term: input.term.trim(), normalizedTerm: normalized })
        .onConflictDoUpdate({
          target: keyword.normalizedTerm,
          set: {
            term: sql`excluded.term`,
            updatedAt: sql`now()`
          }
        })
        .returning({ id: keyword.id, term: keyword.term, normalizedTerm: keyword.normalizedTerm })

    const keywordId = row!.id
    // `aliases` undefined means "leave the aliases alone" (a rename).
    const touchAliases = input.aliases !== undefined
    const aliases = [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0))]
    const normalizedAliases = aliases.values().map(normalizeTerm).filter((alias) => alias !== normalized).toArray()

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
    } else if (touchAliases) {
      yield* tx.delete(keywordAlias).where(sql`${keywordAlias.keywordId} = ${keywordId}`)
    }

    const entries = yield* list(tx, { query: input.term, limit: 1 })
    const updated = entries.find((entry) => entry.id === keywordId)
    return updated ?? toRecord({ ...row!, vacancyCount: 0, aliases: [] })
  })

const loadOne = (tx: Executor, keywordId: string, term: string): RepoEffect<LexiconKeyword> =>
  list(tx, { query: term, limit: 5000 }).pipe(
    Effect.map((entries) => entries.find((entry) => entry.id === keywordId)!)
  )

/** Adds one alias to a keyword; an existing alias keeps its id and stats. */
export const addAlias = (
  tx: Executor,
  input: { readonly keywordId: string; readonly alias: string; readonly typo?: boolean }
): RepoEffect<LexiconKeyword> =>
  Effect.gen(function*() {
    const alias = input.alias.trim()
    const [owner] = yield* tx
      .select({ term: keyword.term, normalizedTerm: keyword.normalizedTerm })
      .from(keyword)
      .where(sql`${keyword.id} = ${input.keywordId}`)
    const normalizedAlias = normalizeTerm(alias)
    if (owner !== undefined && alias !== "" && normalizedAlias !== owner.normalizedTerm) {
      yield* tx
        .insert(keywordAlias)
        .values({
          keywordId: input.keywordId,
          alias,
          normalizedAlias,
          typo: input.typo ?? false
        })
        .onConflictDoNothing()
    }
    return yield* loadOne(tx, input.keywordId, owner!.term)
  })

export const setAliasTypo = (
  tx: Executor,
  input: { readonly id: string; readonly typo: boolean }
): RepoEffect<LexiconKeyword> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .update(keywordAlias)
      .set({ typo: input.typo })
      .where(sql`${keywordAlias.id} = ${input.id}`)
      .returning({ keywordId: keywordAlias.keywordId })
    const [owner] = yield* tx
      .select({ term: keyword.term })
      .from(keyword)
      .where(sql`${keyword.id} = ${row?.keywordId ?? null}`)
    return yield* loadOne(tx, row!.keywordId, owner!.term)
  })

export const removeAlias = (tx: Executor, id: string): RepoEffect<boolean> =>
  tx
    .delete(keywordAlias)
    .where(sql`${keywordAlias.id} = ${id}`)
    .returning({ id: keywordAlias.id })
    .pipe(Effect.map((rows) => rows.length > 0))

export interface RematchRow {
  readonly id: string
  readonly title: string
  readonly descriptionText: string | null
  readonly skills: ReadonlyArray<string>
}

export const countVacancies = (tx: Executor): RepoEffect<number> =>
  tx.execute(sql`select count(*)::int as n from vacancy`).pipe(
    Effect.map((result) => numberValue((result.rows[0] as { n: unknown }).n))
  )

/** Keyset page of vacancies (by id) for the batch re-match. */
export const rematchPage = (
  tx: Executor,
  afterId: string | null,
  limit: number
): RepoEffect<ReadonlyArray<RematchRow>> =>
  tx.execute(sql`
    select v.id, v.title, v.description_text,
           coalesce((
             select json_agg(s.term order by s.position nulls last)
             from vacancy_skill s where s.vacancy_id = v.id
           ), '[]'::json) as skills
    from vacancy v
    ${afterId === null ? sql`` : sql`where v.id > ${afterId}`}
    order by v.id
    limit ${limit}
  `).pipe(
    Effect.map((result) =>
      (result.rows as unknown as ReadonlyArray<{
        id: string
        title: string
        description_text: string | null
        skills: ReadonlyArray<string> | string
      }>).map((row) => ({
        id: row.id,
        title: row.title,
        descriptionText: row.description_text,
        skills: typeof row.skills === "string" ? JSON.parse(row.skills) : row.skills
      }))
    )
  )

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
