import type { ApplyFilterSettings, PresetFilter, PresetRule } from "@otbor/contract"

/**
 * The built-in apply filter: used when neither an (account, resume) row nor an
 * account row exists, and the content of the system preset "DevOps".
 *
 * It reproduces the former `DEFAULT_APPLY_POLICY` (salary floor, remote or
 * hybrid, seniority) and the former DevOps title gate (`gate.ts`).
 *
 * Title stems are plain `contains` (SQL `ilike`): Postgres has no lookbehind,
 * so the word boundary of the old regexes is gone. Consequences:
 * - "sre" matches as a substring of any title;
 * - "водитель" is not a reject stem, because it would reject "руководитель";
 *   drivers are mostly caught by "курьер" and the analysis role.
 */

const title = (op: "contains" | "not_contains", value: string): PresetRule => ({
  field: "title",
  op,
  value
})

/** Former `DEVOPS_GATE_POLICY.strong`, one OR branch per stem. */
export const DEVOPS_TITLE_STEMS: ReadonlyArray<string> = [
  "devops",
  "dev ops",
  "dev-ops",
  "девопс",
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

/** Former `DEVOPS_GATE_POLICY.reject`, one `title not_contains` rule per stem. */
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

export const DEVOPS_APPLY_FILTER: PresetFilter = {
  rules: [
    { field: "seniority", op: "in", value: ["middle", "senior", "lead", "unknown"] },
    ...DEVOPS_TITLE_REJECT_STEMS.map((stem) => title("not_contains", stem))
  ],
  groups: [
    // Salary: from 250 000 RUR, or no salary stated. A foreign currency cannot
    // be compared without a rate, so it is not a block (as before).
    {
      branches: [
        { rules: [{ field: "salary", op: "gte", value: 250_000, orMissing: true }] },
        { rules: [{ field: "salary_currency", op: "in", value: ["USD", "EUR", "KZT", "BYN"] }] }
      ]
    },
    // `work_format in a,b` means "has all of them", so "remote or hybrid" is
    // one branch per format. An unknown format is not a block (as before).
    {
      branches: [
        { rules: [{ field: "work_format", op: "in", value: ["remote"] }] },
        { rules: [{ field: "work_format", op: "in", value: ["hybrid"] }] },
        { rules: [{ field: "work_format", op: "in", value: ["unknown"] }] }
      ]
    },
    // Identity: a DevOps stem in the title, or a confident analysis role.
    {
      branches: [
        ...DEVOPS_TITLE_STEMS.map((stem) => ({ rules: [title("contains", stem)] })),
        { rules: [{ field: "analysis_role", op: "in", value: ["devops", "sre", "platform"] }] }
      ]
    }
  ]
}

export const DEFAULT_APPLY_SETTINGS: ApplyFilterSettings = {
  minFit: 45,
  tests: "human",
  freshHalfLifeHours: 72
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
