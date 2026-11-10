import type { DecisionReason, DecisionRecord, PresetFilter, VacancySummary } from "@otbor/contract"
import {
  decisionReasonLabel,
  experienceLabel,
  employmentFormLabel,
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

const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: "название",
  salary: "зарплата",
  salary_from: "зарплата от",
  salary_to: "зарплата до",
  description: "описание",
  skills: "навыки",
  keywords: "ключевые слова",
  employer: "работодатель",
  area: "город",
  seniority: "уровень",
  work_format: "формат работы",
  experience: "опыт",
  employment_form: "тип занятости",
  published_days: "дней с публикации",
  archived: "архив",
  responses_total: "откликов на hh",
  employer_rating: "рейтинг работодателя",
  analysis_role: "роль",
  analysis_level: "уровень по разбору",
  hidden: "скрыта",
  applied: "отклик в компанию"
}
const OP_WORDS: Readonly<Record<string, string>> = {
  in: "из списка",
  not_in: "кроме",
  eq: "=",
  neq: "не",
  gte: "от",
  lte: "до",
  gt: "больше",
  lt: "меньше",
  contains: "содержит",
  not_contains: "не содержит",
  contains_any: "содержит одно из",
  not_contains_any: "не содержит",
  is_true: "да",
  is_false: "нет"
}

/**
 * Не прошедшие правила фильтра приходят строками вида `salary gte 200000`.
 * Здесь они становятся «зарплата: от 200000»; незнакомый вид остаётся как есть.
 */
export const filterRulesText = (detail: string): string =>
  [...new Set(detail
    .split(/,\s(?=[a-z_]+\s(?:in|not_in|eq|neq|gte|lte|gt|lt|contains|not_contains|contains_any|not_contains_any|is_true|is_false)\b)/)
    .map((part) => {
      const match = /^([a-z_]+)\s+([a-z_]+)(?:\s+(.*))?$/.exec(part.trim())
      const field = match?.[1] === undefined ? undefined : FIELD_WORDS[match[1]]
      const op = match?.[2] === undefined ? undefined : OP_WORDS[match[2]]
      if (match === null || (field === undefined && match[1] !== "location") || op === undefined) return part.trim()
      // Места приходят номерами справочника: по номеру человеку ничего не сказать.
      if (match[1] === "location") return "место работы"
      return `${field}: ${op}${match[3] ? ` ${match[3]}` : ""}`
    }))]
    .join("; ")

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
    case "blocked_filter":
      return {
        mark: "no",
        text: detail === "" ? "не прошла правила фильтра откликов" : `не прошла правило фильтра: ${filterRulesText(detail)}`
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

/** Узкая выборка решений одной вакансии: по названию и работодателю, дальше отбор по id. */
export const decisionsFilter = (vacancy: Pick<VacancySummary, "title" | "employerName">): PresetFilter => ({
  rules: [
    { field: "title", op: "contains", value: vacancy.title },
    ...(vacancy.employerName ? [{ field: "employer" as const, op: "contains" as const, value: vacancy.employerName }] : [])
  ]
})

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
  const lines = text.replace(/\r/g, "").split("\n")
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
