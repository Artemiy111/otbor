import type { DecisionReason, DecisionRecord, PresetFilter, VacancySummary } from "@otbor/contract"
import {
  decisionReasonLabel,
  experienceLabel,
  employmentFormLabel,
  formatNumber,
  RECON_SOURCES,
  seniorityLabel,
  workFormatText,
  type ReconRow,
  type StatusTone
} from "@/shared/lib"

/* ---- решение: причины читаемыми строками ------------------------------------ */

/** `ok` - плюс (✓), `no` - минус (✕), `note` - справка без оценки. */
export interface ReasonLine {
  readonly mark: "ok" | "no" | "note"
  readonly text: string
  /** Для `blocked_filter`: разобранные непрошедшие правила, их карточка рисует сама. */
  readonly failures?: ReadonlyArray<FilterFailure>
}

const DAY_MS = 86_400_000

const ageText = (iso: string, now: Date): string | null => {
  const published = new Date(iso).getTime()
  if (Number.isNaN(published)) return null
  const days = Math.floor((now.getTime() - published) / DAY_MS)
  if (days <= 0) return "опубликована сегодня"
  if (days === 1) return "опубликована вчера"
  return `опубликована ${days} дн. назад`
}

/* ---- причина «не прошла фильтр откликов» ------------------------------------ */

interface FieldWord {
  readonly label: string
  /** Множественное число: влияет на глагол («навыки не содержат»). */
  readonly plural?: boolean
}

const FIELD_WORDS: Readonly<Record<string, FieldWord>> = {
  title: { label: "Название" },
  salary: { label: "Зарплата" },
  salary_from: { label: "Зарплата «от»" },
  salary_to: { label: "Зарплата «до»" },
  description: { label: "Описание" },
  skills: { label: "Навыки", plural: true },
  keywords: { label: "Ключевые слова", plural: true },
  employer: { label: "Работодатель" },
  area: { label: "Город" },
  location: { label: "Место работы" },
  seniority: { label: "Уровень" },
  work_format: { label: "Формат работы" },
  experience: { label: "Опыт" },
  employment_form: { label: "Тип занятости" },
  published_days: { label: "Давность публикации, дней" },
  archived: { label: "Архив" },
  responses_total: { label: "Откликов на hh" },
  employer_rating: { label: "Рейтинг работодателя" },
  analysis_role: { label: "Роль по разбору" },
  analysis_level: { label: "Уровень по разбору" },
  hidden: { label: "Скрытие" },
  applied: { label: "Отклик в компанию" }
}

type RuleOp =
  | "contains" | "not_contains" | "contains_any" | "not_contains_any"
  | "in" | "not_in" | "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "is_true" | "is_false"

/** Сервер пишет операторы как в `describeRule` (`>=`, `is true`); старые строки были словами. */
const OP_ALIASES: Readonly<Record<string, RuleOp>> = {
  contains: "contains",
  not_contains: "not_contains",
  contains_any: "contains_any",
  not_contains_any: "not_contains_any",
  in: "in",
  not_in: "not_in",
  eq: "eq",
  "=": "eq",
  neq: "neq",
  "!=": "neq",
  gte: "gte",
  ">=": "gte",
  lte: "lte",
  "<=": "lte",
  gt: "gt",
  ">": "gt",
  lt: "lt",
  "<": "lt",
  is_true: "is_true",
  "is true": "is_true",
  is_false: "is_false",
  "is false": "is_false"
}
const OP_PATTERN = Object.keys(OP_ALIASES)
  .toSorted((left, right) => right.length - left.length)
  .map((op) => op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|")
const RULE_START = `[a-z_]+\\s(?:${OP_PATTERN})(?=\\s|$)`
const PART_SPLIT = new RegExp(`,\\s(?=any of: |${RULE_START})`)
const RULE_PARSE = new RegExp(`^([a-z_]+)\\s+(${OP_PATTERN})(?:\\s+(.*))?$`, "s")
const LIST_OPS: ReadonlySet<RuleOp> = new Set(["in", "not_in", "contains_any", "not_contains_any"])
const CURRENCY_SIGN: Readonly<Record<string, string>> = { RUR: "₽", RUB: "₽", USD: "$", EUR: "€" }

/** Одно условие словами: «Название не содержит ни одного из слов» и значения отдельно. */
export interface FilterCondition {
  readonly text: string
  readonly items: ReadonlyArray<string>
  /** Список значений оборван сервером: полного числа слов не знаем. */
  readonly cut: boolean
}

/**
 * Одно непрошедшее правило или группа «любое из». У группы `alternatives` это
 * варианты (через `|`), внутри варианта условия идут через `&`.
 */
export interface FilterFailure {
  readonly group: boolean
  readonly alternatives: ReadonlyArray<ReadonlyArray<FilterCondition>>
  /** Хвост группы обрезан: видны не все варианты. */
  readonly more: boolean
}

const valueWords = (field: string, value: string): string => {
  switch (field) {
    case "seniority":
    case "analysis_level":
      return seniorityLabel(value)
    case "work_format":
      return workFormatText(value)
    case "employment_form":
      return employmentFormLabel(value) ?? value
    case "experience":
      return experienceLabel(value) ?? value
    case "hidden":
      return value === "app" ? "в общем чёрном списке" : value === "accounts" ? "в чёрном списке аккаунта" : value === "any" ? "в чёрном списке" : value
    default:
      return value
  }
}

const rawCondition = (text: string): FilterCondition => ({ text, items: [], cut: false })

/** Разбирает одно условие `field op value (RUR, or missing)`; `null`, если вид незнакомый. */
const parseCondition = (source: string, truncated: boolean): FilterCondition | null => {
  const match = RULE_PARSE.exec(source.trim())
  if (match === null) return null
  const [, fieldCode = "", opCode = "", tail = ""] = match
  const field = FIELD_WORDS[fieldCode]
  const op = OP_ALIASES[opCode]
  if (field === undefined || op === undefined) return null

  let rest = tail.trim()
  const cut = truncated || rest.endsWith("…")
  rest = rest.replace(/…$/, "").trimEnd()
  // «(RUR, or missing)»: из дополнений нужна только валюта.
  let currency = ""
  const extras = /^(.*?)\s*\(([^()]*)\)$/.exec(rest)
  if (extras !== null && extras[2]!.split(/,\s*/).every((part) => part === "or missing" || /^[A-Z]{3}$/.test(part))) {
    rest = extras[1]!
    const code = extras[2]!.split(/,\s*/).find((part) => /^[A-Z]{3}$/.test(part))
    currency = code === undefined ? "" : ` ${CURRENCY_SIGN[code] ?? code}`
  }

  let items: Array<string> = []
  if (LIST_OPS.has(op)) {
    items = rest.split(/\s*,\s*/).filter((item) => item !== "")
    // Последнее слово оборванного списка могло потеряться на середине.
    if (cut) items = items.slice(0, -1)
  } else if (rest !== "") {
    items = [rest]
  }
  items = items.map((item) => valueWords(fieldCode, item))

  const label = field.label
  const verb = field.plural === true ? "содержат" : "содержит"
  const number = (value: string | undefined): string => {
    const numeric = Number(value)
    const shown = value !== undefined && value !== "" && Number.isFinite(numeric) ? formatNumber(numeric) : (value ?? "")
    return `${shown}${currency}`
  }
  const one = items[0]
  const cond = (text: string, list: ReadonlyArray<string> = []): FilterCondition => ({ text, items: list, cut })

  switch (op) {
    case "contains_any":
      return cond(`${label} не ${verb} ни одного из слов`, items)
    case "contains":
      return cond(`${label} не ${verb} слова`, items)
    case "not_contains_any":
    case "not_contains":
      return cond(`${label} ${verb} стоп-слова`, items)
    case "in":
      // Места приходят номерами справочника: по номеру человеку ничего не сказать.
      return fieldCode === "location" ? cond("Место работы вне выбранных") : cond(`${label} не из допустимых`, items)
    case "not_in":
      // `applied not_in account:<id>`: идентификаторы человеку не нужны.
      if (fieldCode === "applied") return cond("Вы уже откликались в эту компанию")
      if (fieldCode === "location") return cond("Место работы в исключённых")
      return fieldCode === "hidden" ? cond("Вакансия скрыта", items) : cond(`${label} из исключённых`, items)
    case "eq":
      return cond(`${label}: нужно ${one ?? ""}`.trim())
    case "neq":
      return cond(`${label}: нужно не ${one ?? ""}`.trim())
    case "gte":
      return cond(`${label}: нужно от ${number(one)}`)
    case "lte":
      return cond(`${label}: нужно до ${number(one)}`)
    case "gt":
      return cond(`${label}: нужно больше ${number(one)}`)
    case "lt":
      return cond(`${label}: нужно меньше ${number(one)}`)
    case "is_true":
      return cond(`${label}: нужно «да»`)
    case "is_false":
      if (fieldCode === "archived") return cond("Вакансия в архиве")
      if (fieldCode === "applied") return cond("Вы уже откликались в эту компанию")
      if (fieldCode === "hidden") return cond("Вакансия скрыта")
      return cond(`${label}: нужно «нет»`)
  }
}

const parseGroup = (body: string): FilterFailure | null => {
  const truncated = body.endsWith("…")
  const alternatives: Array<Array<FilterCondition>> = []
  const sources = body.replace(/…$/, "").split(" | ")
  let more = false
  for (const [altIndex, source] of sources.entries()) {
    const conditions: Array<FilterCondition> = []
    const parts = source.split(" & ")
    for (const [partIndex, part] of parts.entries()) {
      const last = truncated && altIndex === sources.length - 1 && partIndex === parts.length - 1
      const condition = parseCondition(part, last)
      if (condition !== null) {
        conditions.push(condition)
        continue
      }
      // Оборванный на середине хвост разобрать нечем: считаем его «и другими».
      if (!last) return null
      more = true
    }
    if (conditions.length > 0) alternatives.push(conditions)
  }
  if (alternatives.length === 0) return null
  return { group: true, alternatives, more: more || truncated }
}

/**
 * Деталь причины `blocked_filter`: правила `поле оператор значение` через запятую
 * и группы `any of: a | b & c`, возможно оборванные «…». Незнакомое остаётся как есть.
 */
export const parseFilterFailures = (detail: string): ReadonlyArray<FilterFailure> => {
  const seen = new Set<string>()
  const failures: Array<FilterFailure> = []
  for (const raw of detail.split(PART_SPLIT)) {
    const part = raw.trim()
    if (part === "") continue
    const failure: FilterFailure = part.startsWith("any of: ")
      ? (parseGroup(part.slice("any of: ".length)) ?? { group: false, alternatives: [[rawCondition(part)]], more: false })
      : (() => {
          const condition = parseCondition(part, false)
          return { group: false, alternatives: [[condition ?? rawCondition(part)]], more: false }
        })()
    const key = filterFailureText(failure)
    if (seen.has(key)) continue
    seen.add(key)
    failures.push(failure)
  }
  return failures
}

/** Сколько значений показывать свёрнутыми. */
export const LIST_PREVIEW = 6

export interface ListPreview {
  readonly shown: ReadonlyArray<string>
  /** Сколько значений спрятано; при обрезанном списке сколько их всего, неизвестно. */
  readonly hidden: number
  /** Список обрезан сервером: после показанных идёт «и другие». */
  readonly other: boolean
  readonly canExpand: boolean
}

/** Какую часть списка показать: первые значения, «и ещё N» либо «и другие» для обрезанного. */
export const listPreview = (items: ReadonlyArray<string>, cut: boolean, expanded = false): ListPreview => {
  if (!cut && (expanded || items.length <= LIST_PREVIEW + 1)) {
    return { shown: items, hidden: 0, other: false, canExpand: false }
  }
  const shown = items.slice(0, LIST_PREVIEW)
  const hidden = items.length - shown.length
  return { shown, hidden: cut ? 0 : hidden, other: cut, canExpand: !cut && hidden > 0 }
}

export const filterConditionText = (condition: FilterCondition): string => {
  if (condition.items.length === 0 && !condition.cut) return condition.text
  const preview = listPreview(condition.items, condition.cut)
  const tail = preview.other ? " и другие" : preview.hidden > 0 ? ` и ещё ${preview.hidden}` : ""
  return `${condition.text}: ${preview.shown.join(", ")}${tail}`
}

/** Группа одной строкой: варианты через «или», условия варианта через «и». */
export const filterFailureText = (failure: FilterFailure): string => {
  const alternatives = failure.alternatives.map((alternative) => alternative.map(filterConditionText).join(" и "))
  return failure.more && failure.group && alternatives.length > 1
    ? `${alternatives.join(" или ")} или другое`
    : alternatives.join(" или ")
}

/** Все непрошедшие правила одной строкой (для заголовков и подсказок). */
export const filterRulesText = (detail: string): string => parseFilterFailures(detail).map(filterFailureText).join("; ")

/**
 * Причина решения одной строкой для человека. Служебные коды и английские
 * детали (`title: k8s`, `fit 40 < 60`, `analysis: senior -> senior`) здесь
 * превращаются в обычные фразы; неизвестное остаётся словами из словаря.
 */
export const reasonLine = (reason: DecisionReason, now: Date = new Date()): ReasonLine => {
  const detail = reason.detail?.trim() ?? ""
  switch (reason.code) {
    case "fit": {
      const model = detail.startsWith("llm")
      return { mark: "note", text: model ? "соответствие оценила модель" : "соответствие посчитано по ключевым словам" }
    }
    case "skill_match": {
      const [place, ...rest] = detail.split(":")
      const terms = rest.join(":").trim()
      const where = place === "title" ? "в заголовке" : "в тексте"
      return { mark: "ok", text: terms === "" ? "совпали навыки" : `совпали навыки ${where}: ${terms}` }
    }
    case "seniority": {
      const match = /->\s*([a-z_]+)/i.exec(detail)
      return {
        mark: "ok",
        text: match?.[1] ? `уровень: ${seniorityLabel(match[1]).toLowerCase()} (по разбору модели)` : "уровень подходит"
      }
    }
    case "freshness": {
      const age = detail === "" ? null : ageText(detail, now)
      return { mark: "note", text: age ?? "дата публикации неизвестна" }
    }
    case "blocked_filter": {
      // Заголовок карточки уже говорит «не прошла фильтр», строка называет только само правило.
      if (detail === "") return { mark: "no", text: "правило фильтра сервер не уточнил" }
      return { mark: "no", text: filterRulesText(detail), failures: parseFilterFailures(detail) }
    }
    case "blocked_low_fit": {
      const match = /(\d+)\s*<\s*(\d+)/.exec(detail)
      return {
        mark: "no",
        text: match ? `соответствие ${match[1]} ниже порога ${match[2]}` : "соответствие ниже порога"
      }
    }
    case "blocked_applied":
      return { mark: "no", text: "вы уже откликались с этим резюме" }
    case "blocked_rejected":
      return { mark: "no", text: detail === "" ? "вы отбраковали вакансию" : `вы отбраковали вакансию: ${detail}` }
    case "blocked_test":
      return { mark: "no", text: detail === "mandatory test" ? "обязательный тест" : "тест не разрешён настройками" }
    case "blocked_blacklist":
      return { mark: "no", text: "работодатель в чёрном списке" }
    case "blocked_archived":
      return { mark: "no", text: "вакансия в архиве" }
    case "blocked_hidden":
      return { mark: "no", text: "вакансия скрыта" }
    case "manual":
      return { mark: "note", text: "решение принято вручную" }
    default: {
      const label = decisionReasonLabel(reason.code)
      const text = label.charAt(0).toLowerCase() + label.slice(1)
      return { mark: reason.code.startsWith("blocked_") ? "no" : "note", text }
    }
  }
}

/** Причины для карточки: сначала решающие, без «справочных», если есть что показать. */
export const reasonLines = (reasons: ReadonlyArray<DecisionReason>, now: Date = new Date()): ReadonlyArray<ReasonLine> => {
  const lines = reasons.map((reason) => reasonLine(reason, now))
  const rank = (line: ReasonLine) => (line.mark === "no" ? 0 : line.mark === "ok" ? 1 : 2)
  return lines.toSorted((left, right) => rank(left) - rank(right))
}

/** Кто решил: оценку соответствия ставит либо модель, либо правила по ключевым словам. */
export const decidedBy = (decision: Pick<DecisionRecord, "reasons">): "model" | "rules" =>
  decision.reasons.some((reason) => reason.code === "fit" && reason.detail?.startsWith("llm") === true)
    ? "model"
    : "rules"

export const verdictText = (decision: Pick<DecisionRecord, "verdict" | "reasons">): string => {
  if (decision.verdict === "apply") return "Подходит: можно откликаться"
  if (decision.verdict === "draft") return "Нужна ваша проверка"
  const blocked = decision.reasons.find((reason) => reason.code.startsWith("blocked_"))
  if (blocked === undefined) return "Пропущена"
  // В заголовке причина коротко; подробности лежат в строках ниже.
  if (blocked.code === "blocked_filter") return "Пропущена: не прошла фильтр откликов"
  return `Пропущена: ${reasonLine(blocked).text}`
}

/** Какое решение показать для выбранных аккаунта и резюме. */
export const pickDecision = (
  decisions: ReadonlyArray<DecisionRecord>,
  accountId: string,
  resumeId: string
): DecisionRecord | null => {
  const byTime = decisions.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  return (
    byTime.find((item) => item.hhAccountId === accountId && item.resumeId === resumeId) ??
    byTime.find((item) => item.hhAccountId === accountId && (item.resumeId ?? null) === null) ??
    byTime.find((item) => item.hhAccountId === accountId) ??
    null
  )
}

/**
 * Запасной путь для сервера без `vacancyId` в запросе решений: узкая выборка по
 * названию и работодателю, дальше отбор по id на клиенте.
 */
export const decisionsFilter = (vacancy: Pick<VacancySummary, "title" | "employerName">): PresetFilter => ({
  rules: [
    { field: "title", op: "contains", value: vacancy.title },
    ...(vacancy.employerName ? [{ field: "employer" as const, op: "contains" as const, value: vacancy.employerName }] : [])
  ]
})

/**
 * Ответ пришёл от старого сервера: он молча игнорирует `vacancyId` и отдаёт
 * решения по другим вакансиям. Пустой ответ - честное «решений нет».
 */
export const isLegacyDecisionsResponse = (
  decisions: ReadonlyArray<Pick<DecisionRecord, "vacancyId">>,
  vacancyId: string
): boolean => decisions.some((decision) => decision.vacancyId !== vacancyId)

/* ---- ключевые факты и сверка источников ------------------------------------- */

/** «Москва · удалённо · опыт 3–6 лет · полная занятость». */
export const keyFactsLine = (
  vacancy: Pick<VacancySummary, "areaName" | "workFormats" | "experienceCode" | "employmentForm">
): string =>
  [
    vacancy.areaName ?? null,
    vacancy.workFormats.length > 0 ? vacancy.workFormats.map(workFormatText).join(", ") : null,
    experienceLabel(vacancy.experienceCode),
    employmentFormLabel(vacancy.employmentForm)
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ")

export interface ReconWording {
  readonly label: string
  /** «hh: удалённо · текст: гибрид · ИИ: гибрид». */
  readonly sources: string
  readonly verdict: "conflict" | "agree" | "single"
  readonly note: string
}

/** Одна строка сверки словами вместо точек: что сказал каждый источник и сошлись ли они. */
export const reconWording = (row: ReconRow): ReconWording => {
  const said = RECON_SOURCES.map((source) => {
    const cell = row.cells[source.id]
    if (cell.norm === null && cell.text === null) return null
    const value = cell.norm === "нет" ? "нет" : (cell.text ?? cell.norm ?? "")
    return `${source.short}: ${value === "да" ? "да" : value}`
  }).filter((part): part is string => part !== null)
  const verdict = row.conflict ? "conflict" : row.answered > 1 ? "agree" : "single"
  const note = verdict === "conflict" ? "расхождение" : verdict === "agree" ? "совпало" : "один источник"
  return { label: row.label, sources: said.join(" · "), verdict, note }
}

/* ---- описание: абзацы, списки, заголовки ------------------------------------ */

export type DescriptionBlock =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<string> }
  | { readonly kind: "paragraph"; readonly text: string }

const BULLET = /^\s*(?:[-–—•·*]|\d+[.)])\s+/

/**
 * Разбивает плоский текст описания на заголовки, списки и абзацы. Заголовок это
 * короткая строка с двоеточием на конце, отдельной строкой, перед которой пусто
 * или после которой идёт список.
 */
export const descriptionBlocks = (text: string): ReadonlyArray<DescriptionBlock> => {
  const blocks: Array<DescriptionBlock> = []
  let list: Array<string> | null = null
  let paragraph: Array<string> = []
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") })
    paragraph = []
  }
  const flushList = () => {
    if (list !== null && list.length > 0) blocks.push({ kind: "list", items: list })
    list = null
  }
  // «Обязанности: • первый пункт» в одной строке: заголовок и пункт отдельно.
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((raw) => {
      const inline = /^(\s*[^•·]{1,70}[:：])\s+([•·]\s+.*)$/.exec(raw)
      return inline === null ? [raw] : [inline[1]!, inline[2]!]
    })
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === "") {
      flushParagraph()
      flushList()
      continue
    }
    if (BULLET.test(line)) {
      flushParagraph()
      list ??= []
      list.push(line.replace(BULLET, ""))
      continue
    }
    // Пункты без значков, но с «;» на конце, продолжают начатый список.
    if (list !== null && list.length > 0 && /[;；]$/.test(list[list.length - 1]!)) {
      list.push(line)
      continue
    }
    const next = (lines[index + 1] ?? "").trim()
    const isHeading = line.length <= 70 && /[:：]$/.test(line) && (next === "" || BULLET.test(next))
    if (isHeading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: "heading", text: line.replace(/[:：]$/, "") })
      continue
    }
    if (list !== null) flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

/** Самый свежий отклик на каждую пару «аккаунт + резюме», новые выше. */
export const latestApplications = <A extends { hhAccountId: string; resumeId?: string | null; updatedAt: string }>(
  applications: ReadonlyArray<A>
): ReadonlyArray<A> => {
  const newest = new Map<string, A>()
  for (const application of applications) {
    const key = `${application.hhAccountId}|${application.resumeId ?? ""}`
    const current = newest.get(key)
    if (current === undefined || application.updatedAt > current.updatedAt) newest.set(key, application)
  }
  return [...newest.values()].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** Шкала не выходит за 0..100, даже если сервер прислал лишнее. */
export const fitPercent = (fit: number): number => Math.max(0, Math.min(100, Math.round(fit)))

/** Тон числа и шкалы соответствия: те же границы, что в списке вакансий. */
export const fitTone = (fit: number): StatusTone => (fit >= 75 ? "success" : fit >= 50 ? "warning" : "danger")

/**
 * Соответствие не считалось: вакансию отсекло правило до расчёта (фильтр, отклик, архив),
 * и 0 в записи означает «нет оценки», а не «совсем не подходит».
 */
export const fitWasComputed = (decision: Pick<DecisionRecord, "verdict" | "reasons">): boolean => {
  if (decision.verdict !== "skip") return true
  const first = decision.reasons[0]
  return first === undefined || first.code === "blocked_low_fit" || !first.code.startsWith("blocked_")
}
