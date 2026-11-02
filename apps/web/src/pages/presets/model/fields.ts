import type {
  KeywordMatchLocation,
  PresetField,
  PresetOperator,
  PresetRule
} from "@otbor/contract"
import { roleFamilyLabel, seniorityLabel, statusLabel, workFormatLabel } from "@/shared/lib"

/**
 * Browser-side mirror of the preset whitelist. The backend owns enforcement;
 * this file owns labels, grouping and which controls the editor renders.
 */
export type PresetFieldKind = "text" | "select" | "number" | "boolean"

export const PRESET_FIELD_GROUP_ORDER = [
  "Текст и словарь",
  "Классификация",
  "Зарплата и метрики",
  "Прочее"
] as const

export type PresetFieldGroup = (typeof PRESET_FIELD_GROUP_ORDER)[number]

export interface PresetFieldOption {
  readonly value: string
  readonly label: string
}

export interface PresetFieldMeta {
  readonly field: PresetField
  readonly label: string
  readonly group: PresetFieldGroup
  readonly kind: PresetFieldKind
  readonly ops: ReadonlyArray<PresetOperator>
  readonly options?: ReadonlyArray<PresetFieldOption>
  readonly hint?: string
}

export interface PresetFieldGroupMeta {
  readonly group: PresetFieldGroup
  readonly fields: ReadonlyArray<PresetFieldMeta>
}

const TEXT_OPS: ReadonlyArray<PresetOperator> = [
  "contains",
  "not_contains",
  "eq",
  "neq",
  "in",
  "not_in"
]

const NUMBER_OPS: ReadonlyArray<PresetOperator> = ["eq", "neq", "gte", "lte"]

const BOOLEAN_OPS: ReadonlyArray<PresetOperator> = ["is_true", "is_false"]

const SELECT_OPS: ReadonlyArray<PresetOperator> = ["eq", "neq", "in", "not_in"]

const OPTIONS = (...pairs: ReadonlyArray<readonly [string, string]>): ReadonlyArray<PresetFieldOption> =>
  pairs.map(([value, label]) => ({ value, label }))

const SENIORITY_OPTIONS = OPTIONS(
  ["junior", seniorityLabel("junior")],
  ["middle", seniorityLabel("middle")],
  ["senior", seniorityLabel("senior")],
  ["lead", seniorityLabel("lead")],
  ["unknown", seniorityLabel("unknown")]
)

const WORK_FORMAT_OPTIONS = OPTIONS(
  ["remote", workFormatLabel("remote")],
  ["hybrid", workFormatLabel("hybrid")],
  ["office", workFormatLabel("office")],
  ["unknown", workFormatLabel("unknown")]
)

const EXPERIENCE_OPTIONS = OPTIONS(
  ["noExperience", "Без опыта"],
  ["between1And3", "1–3 года"],
  ["between3And6", "3–6 лет"],
  ["moreThan6", "Более 6 лет"]
)

const EMPLOYMENT_FORM_OPTIONS = OPTIONS(
  ["FULL", "Полная занятость"],
  ["PART", "Частичная занятость"],
  ["PROJECT", "Проектная работа"],
  ["VOLUNTEER", "Волонтёрство"],
  ["PROBATION", "Стажировка"]
)

const GATE_OPTIONS = OPTIONS(
  ["match", statusLabel("match")],
  ["unknown", statusLabel("unknown")],
  ["reject", statusLabel("reject")]
)

const ROLE_FAMILY_OPTIONS = OPTIONS(
  ["devops", roleFamilyLabel("devops")],
  ["sre", roleFamilyLabel("sre")],
  ["platform", roleFamilyLabel("platform")],
  ["backend", roleFamilyLabel("backend")],
  ["frontend", roleFamilyLabel("frontend")],
  ["mobile", roleFamilyLabel("mobile")],
  ["qa", roleFamilyLabel("qa")],
  ["analyst", roleFamilyLabel("analyst")],
  ["manager", roleFamilyLabel("manager")],
  ["other", roleFamilyLabel("other")]
)

export const PRESET_FIELDS: ReadonlyArray<PresetFieldMeta> = [
  {
    field: "title",
    label: "Заголовок",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Подстрока в названии вакансии без учёта регистра."
  },
  {
    field: "description",
    label: "Описание",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Текст описания вакансии."
  },
  {
    field: "skills",
    label: "Навыки hh",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Блок «Ключевые навыки» на странице вакансии."
  },
  {
    field: "keywords",
    label: "Ключевые слова",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Совпадения по словарю. Для «входит» выберите термины."
  },
  {
    field: "employer",
    label: "Работодатель",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Название компании."
  },
  {
    field: "area",
    label: "Город",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Регион из карточки вакансии."
  },
  {
    field: "salary_currency",
    label: "Валюта",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Код валюты, например RUR."
  },
  {
    field: "source",
    label: "Источник",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Источник вакансии, сейчас это hh."
  },
  {
    field: "seniority",
    label: "Грейд",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: SENIORITY_OPTIONS
  },
  {
    field: "work_format",
    label: "Формат работы",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: WORK_FORMAT_OPTIONS
  },
  {
    field: "experience",
    label: "Опыт",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: EXPERIENCE_OPTIONS
  },
  {
    field: "employment_form",
    label: "Тип занятости",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: EMPLOYMENT_FORM_OPTIONS
  },
  {
    field: "gate",
    label: "Вердикт гейта",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: GATE_OPTIONS,
    hint: "Кэшированный вердикт по заголовку вакансии."
  },
  {
    field: "role_family",
    label: "Роль",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: ROLE_FAMILY_OPTIONS
  },
  {
    field: "salary_from",
    label: "Зарплата от",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS
  },
  {
    field: "salary_to",
    label: "Зарплата до",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS
  },
  {
    field: "published_days",
    label: "Опубликована за, дней",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    hint: "Сколько дней назад вакансия появилась на hh."
  },
  {
    field: "responses_total",
    label: "Откликов",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS
  },
  {
    field: "description_length",
    label: "Длина описания",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    hint: "Число символов в описании вакансии."
  },
  {
    field: "skills_count",
    label: "Навыков в вакансии",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS
  },
  {
    field: "archived",
    label: "Архивная",
    group: "Прочее",
    kind: "boolean",
    ops: BOOLEAN_OPS,
    hint: "Обычно достаточно галочки «Показывать архивные»."
  }
]

const FIELD_BY_NAME = new Map<PresetField, PresetFieldMeta>(
  PRESET_FIELDS.map((meta) => [meta.field, meta])
)

export const presetFieldMeta = (field: PresetField): PresetFieldMeta =>
  FIELD_BY_NAME.get(field) ?? PRESET_FIELDS[0]!

export const PRESET_FIELD_GROUPS: ReadonlyArray<PresetFieldGroupMeta> =
  PRESET_FIELD_GROUP_ORDER.map((group) => ({
    group,
    fields: PRESET_FIELDS.filter((meta) => meta.group === group)
  })).filter((group) => group.fields.length > 0)

export const PRESET_OPERATOR_LABELS: Record<PresetOperator, string> = {
  contains: "содержит",
  not_contains: "не содержит",
  eq: "равно",
  neq: "не равно",
  in: "входит в",
  not_in: "не входит в",
  gte: "не меньше",
  lte: "не больше",
  is_true: "да",
  is_false: "нет"
}

export const presetOperatorLabel = (op: PresetOperator): string =>
  PRESET_OPERATOR_LABELS[op]

export const isMultiValueOperator = (op: PresetOperator): boolean =>
  op === "in" || op === "not_in"

export const PRESET_LOCATION_LABELS: Record<KeywordMatchLocation, string> = {
  any: "Везде",
  title: "В заголовке",
  body: "В описании",
  skills: "В навыках",
  text_or_skills: "В тексте или навыках"
}

export const PRESET_LOCATION_OPTIONS: ReadonlyArray<PresetFieldOption> = (
  ["any", "title", "body", "skills", "text_or_skills"] as const
).map((value) => ({ value, label: PRESET_LOCATION_LABELS[value] }))

/** Russian label for one stored value of a select field. */
export const presetValueLabel = (
  field: PresetField,
  value: string | number | boolean
): string => {
  if (typeof value === "boolean") return value ? "да" : "нет"
  const option = presetFieldMeta(field).options?.find((item) => item.value === String(value))
  return option?.label ?? String(value)
}

/** A rule value as the detail page reads it: arrays and booleans included. */
export const ruleValueLabel = (rule: PresetRule): string => {
  const meta = presetFieldMeta(rule.field)
  if (meta.kind === "boolean") return rule.op === "is_true" ? "да" : "нет"
  const value = rule.value
  if (value === undefined) return ""
  if (Array.isArray(value)) {
    return (value as ReadonlyArray<string>)
      .map((item) => presetValueLabel(rule.field, item))
      .join(", ")
  }
  return presetValueLabel(rule.field, value as string | number | boolean)
}

/** "Заголовок: содержит backend" — one line per rule in the detail card. */
export const describePresetRule = (rule: PresetRule): string => {
  const label = presetFieldMeta(rule.field).label
  const op = presetOperatorLabel(rule.op)
  const value = ruleValueLabel(rule)
  return value === "" ? `${label}: ${op}` : `${label}: ${op} ${value}`
}
