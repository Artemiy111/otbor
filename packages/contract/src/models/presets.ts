import { Predicate, Schema } from "effect"
import {
  KeywordMatchLocation,
  LetterPolicy,
  PresetKind,
  StreamMode,
  TestsPolicy
} from "../enums.ts"
import { EmployerId, HhAccountId, KeywordId, PresetId, UserId } from "../ids.ts"
import { VacancySummary } from "./corpus.ts"

/**
 * The concrete filter a preset carries. Every field is optional: an absent
 * field does not constrain the result.
 *
 * `text` matches the vacancy title case-insensitively. Archived vacancies are excluded unless a
 * rule on the `archived` field says otherwise. `keywordIds` only narrows which keywords are returned;
 * it never changes which vacancies are counted.
 */
/**
 * A preset is a conjunction of rules plus a few legacy shorthands. The legacy
 * `text` field predates the rule builder and is normalized into rules by the
 * UI; it stays in the schema so old rows keep working.
 */
export const PresetField = Schema.Literals([
  "title",
  /**
   * The salary the vacancy states, compared as a range: `>`/`>=` look at its
   * upper end, `<`/`<=` at its lower end, `=` means the number lies inside it.
   * A rule may pin a `currency` and may accept vacancies without a salary.
   */
  "salary",
  "description",
  "skills",
  "keywords",
  "employer",
  "area",
  /**
   * Where the vacancy is: values are hh area ids (as strings) from the
   * country > region > city tree. A country covers all its cities.
   */
  "location",
  "salary_from",
  "salary_to",
  "salary_currency",
  "seniority",
  "work_format",
  "experience",
  "employment_form",
  "published_days",
  "archived",
  "source",
  "responses_total",
  "skills_count",
  /** Open (non-archived) vacancies of the same employer in the corpus; a company-size proxy. */
  "employer_vacancies",
  /** hh employer rating, 0-5; rules never match employers without one. */
  "employer_rating",
  /** Number of hh employer reviews; a company-size proxy. */
  "employer_reviews",
  /** Role from the vacancy analysis (devops, sre, backend, ...); unknown when the model was not confident. */
  "analysis_role",
  /** Required level from the vacancy analysis (junior, middle, senior, tech_lead, ...); unknown when not confident. */
  "analysis_level",
  /**
   * Whether the vacancy (or its employer) is hidden. Values are selectors:
   * `any`, `app`, `accounts`, `hh`, `account:<hh account id>`, `hh:<hh account id>`.
   * `in` matches when at least one selector hides it, `not_in` when none does.
   */
  "hidden",
  /**
   * Whether a sent application (state `submitted`, imported ones included)
   * exists to any vacancy of the vacancy's employer. Values are selectors:
   * `any`, `account:<hh account id>`, `resume:<resume id>`. `in` matches when
   * at least one selector has an application, `not_in` when none does.
   * Rules are ANDed, so "applied with resume A but not with resume B" is two rules.
   */
  "applied"
])

export type PresetField = typeof PresetField.Type

export const PresetOperator = Schema.Literals([
  "contains",
  "not_contains",
  /** Text contains any of the listed substrings. */
  "contains_any",
  /** Text contains none of the listed substrings. */
  "not_contains_any",
  "eq",
  "neq",
  "in",
  "not_in",
  "gte",
  "lte",
  "gt",
  "lt",
  "is_true",
  "is_false"
])

export type PresetOperator = typeof PresetOperator.Type

export const PresetRuleValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String)
])

export type PresetRuleValue = typeof PresetRuleValue.Type

export const PresetRule = Schema.Struct({
  field: PresetField,
  op: PresetOperator,
  value: Schema.optional(PresetRuleValue),
  /** `salary` only: the rule applies to this currency code (hh: RUR, USD, EUR, ...). */
  currency: Schema.optional(Schema.String),
  /** `salary` only: a vacancy without any salary passes the rule too. */
  orMissing: Schema.optional(Schema.Boolean)
})

export type PresetRule = typeof PresetRule.Type

/**
 * "Any of": a vacancy passes when it satisfies every rule of at least one
 * branch. Rules of a filter are ANDed; a group is how to say OR, e.g. rubles
 * from 200k, or dollars from 3k.
 */
export const PresetGroup = Schema.Struct({
  branches: Schema.Array(Schema.Struct({ rules: Schema.Array(PresetRule) }))
})

export type PresetGroup = typeof PresetGroup.Type

export const PresetFilter = Schema.Struct({
  /** Additional AND rules over vacancy fields. */
  rules: Schema.optional(Schema.Array(PresetRule)),
  /** Additional AND clauses, each an OR over branches of rules. */
  groups: Schema.optional(Schema.Array(PresetGroup)),
  text: Schema.optional(Schema.String),
  keywordIds: Schema.optional(Schema.Array(KeywordId)),
  /** Where a keyword must appear: title, body, HH skills, or text+skills. */
  location: Schema.optional(KeywordMatchLocation)
})

export type PresetFilter = typeof PresetFilter.Type

export const emptyPresetFilter: PresetFilter = {}

/** Fields of the removed title gate; old stored filters may still carry them. */
const LEGACY_GATE_FIELDS: ReadonlySet<unknown> = new Set(["gate", "role_family"])

const withoutLegacyRules = (rules: unknown): unknown =>
  Array.isArray(rules)
    ? rules.filter((rule) => !(Predicate.isObject(rule) && LEGACY_GATE_FIELDS.has(rule.field)))
    : rules

/**
 * Removes the legacy `gate` key and every `gate` / `role_family` rule (top
 * level and inside group branches) from a raw filter, so filters stored before
 * the title gate was removed still decode. Anything else is passed through.
 */
export const stripLegacyGate = (input: unknown): unknown => {
  if (!Predicate.isObject(input) || Array.isArray(input)) return input
  const { gate: _gate, ...rest } = input as Record<string, unknown>
  return {
    ...rest,
    ...(rest.rules === undefined ? {} : { rules: withoutLegacyRules(rest.rules) }),
    ...(Array.isArray(rest.groups)
      ? {
        groups: rest.groups.map((group) =>
          Predicate.isObject(group) && Array.isArray(group.branches)
            ? {
              ...group,
              branches: group.branches.map((branch) =>
                Predicate.isObject(branch) ? { ...branch, rules: withoutLegacyRules(branch.rules) } : branch
              )
            }
            : group
        )
      }
      : {})
  }
}

/** A rule that constrains something: a flag operator, or a non-empty value. */
export const isCompleteRule = (rule: PresetRule): boolean => {
  if (rule.op === "is_true" || rule.op === "is_false") return true
  if (rule.value === undefined || rule.value === "") return false
  return !Array.isArray(rule.value) || rule.value.length > 0
}

/**
 * Parses a stored or submitted filter and drops values that mean "no
 * constraint": blank text and an empty keyword list.
 * Unknown properties (the legacy `{"all":[]}` default) are ignored.
 */
export const parsePresetFilter = (input: unknown): PresetFilter => {
  const decoded = Schema.decodeUnknownSync(PresetFilter)(stripLegacyGate(input ?? {}))
  const text = decoded.text?.trim() ?? ""
  const keywordIds = decoded.keywordIds === undefined
    ? []
    : [...new Set(decoded.keywordIds)]
  const complete = isCompleteRule
  const rules = (decoded.rules ?? []).filter(complete)
  const groups = (decoded.groups ?? [])
    .map((group) => ({
      branches: group.branches
        .map((branch) => ({ rules: branch.rules.filter(complete) }))
        .filter((branch) => branch.rules.length > 0)
    }))
    .filter((group) => group.branches.length > 0)

  return {
    ...(rules.length === 0 ? {} : { rules }),
    ...(groups.length === 0 ? {} : { groups }),
    ...(text === "" ? {} : { text }),
    ...(keywordIds.length === 0 ? {} : { keywordIds }),
    ...(decoded.location === undefined || decoded.location === "any"
      ? {}
      : { location: decoded.location })
  }
}

export const PresetRecord = Schema.Struct({
  id: PresetId,
  userId: Schema.optional(Schema.NullOr(UserId)),
  kind: PresetKind,
  title: Schema.String,
  filter: PresetFilter,
  system: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type PresetRecord = typeof PresetRecord.Type
export const PresetFacet = Schema.Struct({
  term: Schema.String,
  count: Schema.Int
})

export type PresetFacet = typeof PresetFacet.Type

export const PresetCompanyFacet = Schema.Struct({
  id: EmployerId,
  name: Schema.String,
  count: Schema.Int
})

export type PresetCompanyFacet = typeof PresetCompanyFacet.Type

/** A live preview of what the current preset rules select. */
export const PresetPreview = Schema.Struct({
  count: Schema.Int,
  keywords: Schema.Array(PresetFacet),
  skills: Schema.Array(PresetFacet),
  companies: Schema.Array(PresetCompanyFacet),
  vacancies: Schema.Array(VacancySummary)
})

export type PresetPreview = typeof PresetPreview.Type

export const StreamRecord = Schema.Struct({
  id: Schema.String,
  userId: UserId,
  hhAccountId: HhAccountId,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  presetId: Schema.optional(Schema.NullOr(PresetId)),
  mode: StreamMode,
  letterPolicy: LetterPolicy,
  testsPolicy: TestsPolicy,
  enabled: Schema.Boolean
})

export type StreamRecord = typeof StreamRecord.Type
