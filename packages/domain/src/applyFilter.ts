import type { ApplyBoost, ApplyFilterSettings, PresetFilter, PresetRule } from "@otbor/contract"

/**
 * The built-in apply filter: used when neither an (account, resume) row nor an
 * account row exists, and the content of the system preset "DevOps".
 *
 * It reproduces the former `DEFAULT_APPLY_POLICY` (salary floor, remote or
 * hybrid, seniority) and the former DevOps title gate.
 *
 * Title stems are plain `contains` (SQL `ilike`): Postgres has no lookbehind,
 * so the word boundary of the old regexes is gone. Consequences:
 * - "sre" matches as a substring of any title;
 * - "водитель" is not a reject stem, because it would reject "руководитель";
 *   drivers are mostly caught by "курьер" and the analysis role.
 */

/** Former `DEVOPS_GATE_POLICY.strong`, now the list of one `title contains_any` rule. */
export const DEVOPS_TITLE_STEMS: ReadonlyArray<string> = [
  "devops",
  "dev ops",
  "dev-ops",
  "devsecops",
  "dev sec ops",
  "dev-sec-ops",
  "mlops",
  "ml ops",
  "ml-ops",
  "девопс",
  "девсекопс",
  "млопс",
  "sre",
  "site reliability",
  "site-reliability",
  "platform engineer",
  "platform-engineer",
  "инженер платформ",
  "инженера платформ",
  "руководитель платформ",
  "руководителя платформ"
]

/** Former `DEVOPS_GATE_POLICY.reject`, now the list of one `title not_contains_any` rule. */
export const DEVOPS_TITLE_REJECT_STEMS: ReadonlyArray<string> = [
  "системный администратор",
  "системного администратор",
  "системных администратор",
  "продаж",
  "кладовщик",
  "завсклад",
  "складск",
  "бухгалтер",
  "поддержка пользовател",
  "поддержки пользовател",
  "поддержку пользовател",
  "рекрутер",
  "recruiter",
  "hr-менеджер",
  "hr менеджер",
  "дизайнер",
  "designer",
  "маркетолог",
  "маркетинг",
  "юрист",
  "юридическ",
  "охранник",
  "сторож",
  "повар",
  "официант",
  "бармен",
  "курьер",
  "call-центр",
  "call центр",
  "оператор call",
  "менеджер по персоналу",
  "секретар",
  "экономист"
]

/**
 * The built-in template, also the fallback filter when none is stored.
 * Batch staleness looks at `APPLY_POLICY_VERSION`, not at this value: when you
 * change it, bump `APPLY_POLICY_VERSION` in decision.ts so decisions refresh.
 */
export const DEVOPS_APPLY_FILTER: PresetFilter = {
  rules: [
    { field: "seniority", op: "in", value: ["middle", "senior", "lead", "unknown"] },
    // One rule with a list: "the title contains none of these".
    { field: "title", op: "not_contains_any", value: [...DEVOPS_TITLE_REJECT_STEMS] },
    // Nothing is hidden implicitly: archived vacancies and the app blacklist are plain rules.
    { field: "archived", op: "is_false" },
    { field: "hidden", op: "not_in", value: ["app"] }
  ],
  groups: [
    // Salary and work format are deliberately not part of the template: they
    // are personal and belong to the user's own apply filter.
    // Identity: a DevOps stem in the title, or a confident analysis role.
    {
      branches: [
        // One rule with a list: "the title contains any of these".
        { rules: [{ field: "title", op: "contains_any", value: [...DEVOPS_TITLE_STEMS] }] },
        { rules: [{ field: "analysis_role", op: "in", value: ["devops", "sre", "platform"] }] }
      ]
    }
  ]
}

/**
 * The fit bonuses that used to be constants in `decide`. `work_format in`
 * means "has all of them", so `[remote]` is "offers remote".
 */
export const DEFAULT_BOOSTS: ReadonlyArray<ApplyBoost> = [
  { rule: { field: "salary", op: "gte", value: 250_000, currency: "RUB" }, weight: 8 },
  { rule: { field: "work_format", op: "in", value: ["remote"] }, weight: 5 },
  { rule: { field: "seniority", op: "in", value: ["middle", "senior", "lead", "unknown"] }, weight: 4 }
]

export const DEFAULT_DAILY_LIMIT = 200

export const DEFAULT_APPLY_SETTINGS: ApplyFilterSettings = {
  minFit: 45,
  tests: "human",
  freshHalfLifeHours: 72,
  autoMode: "off",
  dailyLimit: DEFAULT_DAILY_LIMIT,
  batchSize: 20,
  sort: "priority",
  sortDirection: "desc",
  minPriority: 0,
  boosts: DEFAULT_BOOSTS,
  writingHarness: null,
  writingModel: null,
  writingEffort: null
}

/** A filter plus the scoring settings stored next to it. */
export interface ApplyFilterTemplate extends ApplyFilterSettings {
  readonly filter: PresetFilter
}

export const DEFAULT_APPLY_FILTER: ApplyFilterTemplate = {
  filter: DEVOPS_APPLY_FILTER,
  ...DEFAULT_APPLY_SETTINGS
}

/** Title of the seeded system preset holding {@link DEVOPS_APPLY_FILTER}. */
export const DEVOPS_PRESET_TITLE = "DevOps"

const valueText = (rule: PresetRule): string => {
  const value = rule.value
  if (value === undefined) return ""
  return Array.isArray(value) ? value.join(",") : String(value)
}

const OPERATOR_TEXT: Record<PresetRule["op"], string> = {
  contains: "contains",
  not_contains: "not_contains",
  contains_any: "contains_any",
  not_contains_any: "not_contains_any",
  eq: "=",
  neq: "!=",
  in: "in",
  not_in: "not_in",
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
  is_true: "is true",
  is_false: "is false"
}

/** A readable one-line label of a rule: `salary >= 250000`, `work_format in remote,hybrid`. */
export const describeRule = (rule: PresetRule): string => {
  const op = OPERATOR_TEXT[rule.op]
  const base = rule.op === "is_true" || rule.op === "is_false"
    ? `${rule.field} ${op}`
    : `${rule.field} ${op} ${valueText(rule)}`
  const extras = [
    rule.currency === undefined || rule.currency === "" ? null : rule.currency,
    rule.orMissing === true ? "or missing" : null
  ].filter((part): part is string => part !== null)
  return extras.length === 0 ? base : `${base} (${extras.join(", ")})`
}

const MAX_GROUP_LABEL = 160

/** `any of: a | b & c | d`, cut to a sane length for a reason detail. */
export const describeGroup = (group: NonNullable<PresetFilter["groups"]>[number]): string => {
  const text = group.branches
    .filter((branch) => branch.rules.length > 0)
    .map((branch) => branch.rules.map(describeRule).join(" & "))
    .join(" | ")
  const label = `any of: ${text}`
  return label.length <= MAX_GROUP_LABEL ? label : `${label.slice(0, MAX_GROUP_LABEL - 1)}…`
}
