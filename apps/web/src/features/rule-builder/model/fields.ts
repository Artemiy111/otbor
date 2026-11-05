import type {
  KeywordMatchLocation,
  PresetField,
  PresetOperator,
  PresetRule
} from "@otbor/contract"
import { areaLabel, ANALYSIS_LEVEL_LABELS, ANALYSIS_ROLE_LABELS, roleFamilyLabel, seniorityLabel, statusLabel, workFormatLabel } from "@/shared/lib"

/**
 * Browser-side mirror of the preset whitelist. The backend owns enforcement;
 * this file owns labels, grouping and which controls the editor renders.
 */
export type PresetFieldKind = "text" | "select" | "number" | "boolean" | "location"

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
  /** Operator a fresh rule starts with; defaults to the first one. */
  readonly defaultOp?: PresetOperator
  /** Older field kept so stored rules still read; not offered for new rules. */
  readonly legacy?: boolean
  /** The rule also carries a currency and "or no salary" (the salary field). */
  readonly salary?: boolean
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

const NUMBER_OPS: ReadonlyArray<PresetOperator> = ["lt", "lte", "eq", "gt", "gte", "neq"]

const BOOLEAN_OPS: ReadonlyArray<PresetOperator> = ["is_true", "is_false"]

const SELECT_OPS: ReadonlyArray<PresetOperator> = ["eq", "neq", "in", "not_in"]

const OPTIONS = (...pairs: ReadonlyArray<readonly [string, string]>): ReadonlyArray<PresetFieldOption> =>
  pairs.map(([value, label]) => ({ value, label }))

const ANALYSIS_ROLE_OPTIONS = OPTIONS(...Object.entries(ANALYSIS_ROLE_LABELS))
const ANALYSIS_LEVEL_OPTIONS = OPTIONS(...Object.entries(ANALYSIS_LEVEL_LABELS))

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
    label: "Город (по тексту)",
    group: "Текст и словарь",
    kind: "text",
    ops: TEXT_OPS,
    hint: "Регион из карточки вакансии."
  },
  {
    field: "location",
    label: "Локация",
    group: "Классификация",
    kind: "location",
    ops: ["in", "not_in"],
    hint: "Страна, регион или город по справочнику hh. Страна включает все её города."
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
    label: "Проверка заголовка",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: GATE_OPTIONS,
    hint: "Правило по заголовку: подходит, неясно или отклонено. Это не ИИ."
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
    field: "analysis_role",
    label: "Роль по анализу модели",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: ANALYSIS_ROLE_OPTIONS,
    hint: "Роль, которую определила модель по тексту вакансии. Пусто, если модель не уверена."
  },
  {
    field: "analysis_level",
    label: "Уровень по анализу модели",
    group: "Классификация",
    kind: "select",
    ops: SELECT_OPS,
    options: ANALYSIS_LEVEL_OPTIONS,
    hint: "Требуемый уровень по тексту вакансии. Пусто, если модель не уверена."
  },
  {
    field: "salary",
    label: "Зарплата",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    defaultOp: "gte",
    salary: true,
    hint: "Вилка вакансии: > и >= смотрят на её верх, < и <= на низ, = значит «число внутри вилки»."
  },
  {
    field: "salary_from",
    label: "Зарплата от (старое)",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    legacy: true
  },
  {
    field: "salary_to",
    label: "Зарплата до (старое)",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    legacy: true
  },
  {
    field: "published_days",
    label: "Опубликована за, дней",
    group: "Зарплата и метрики",
    kind: "number",
    ops: ["lte"],
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
    field: "employer_vacancies",
    label: "Вакансий у работодателя",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS,
    hint: "Открытых вакансий этого работодателя в базе; грубая оценка размера компании."
  },
  {
    field: "employer_rating",
    label: "Рейтинг работодателя",
    group: "Зарплата и метрики",
    kind: "number",
    ops: NUMBER_OPS
  },
  {
    field: "employer_reviews",
    label: "Отзывов о работодателе",
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
  PRESET_FIELD_GROUP_ORDER.values()
    .map((group) => ({
      group,
      fields: PRESET_FIELDS.filter((meta) => meta.group === group && meta.legacy !== true)
    }))
    .filter((group) => group.fields.length > 0)
    .toArray()

export const PRESET_OPERATOR_LABELS: Record<PresetOperator, string> = {
  contains: "содержит",
  not_contains: "не содержит",
  eq: "равно",
  neq: "не равно",
  in: "входит в",
  not_in: "не входит в",
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
  is_true: "да",
  is_false: "нет"
}

/** Number fields read as math: `>=`, `=`, `!=`; text fields keep words. */
const NUMBER_OPERATOR_LABELS: Partial<Record<PresetOperator, string>> = {
  eq: "=",
  neq: "!="
}

export const presetOperatorLabel = (op: PresetOperator, field?: PresetField): string =>
  field !== undefined && presetFieldMeta(field).kind === "number"
    ? (NUMBER_OPERATOR_LABELS[op] ?? PRESET_OPERATOR_LABELS[op])
    : PRESET_OPERATOR_LABELS[op]

export const SALARY_CURRENCIES: ReadonlyArray<PresetFieldOption> = [
  { value: "RUR", label: "₽ RUR" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
  { value: "KZT", label: "KZT" },
  { value: "BYN", label: "BYN" }
]

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
  if (field === "location") return areaLabel(value)
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
  const meta = presetFieldMeta(rule.field)
  const label = meta.label
  const op = presetOperatorLabel(rule.op, rule.field)
  const value = ruleValueLabel(rule)
  const base = value === "" ? `${label}: ${op}` : `${label}: ${op} ${value}`
  if (!meta.salary) return base
  const currency = rule.currency === undefined || rule.currency === "" ? "" : ` ${rule.currency}`
  return `${base}${currency}${rule.orMissing === true ? " (или не указана)" : ""}`
}
