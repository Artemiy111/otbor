import type { CrawlSchedule, ScheduleKind } from "@otbor/contract"
import { formatSearchUrl } from "@otbor/contract"
import { scheduleKindLabel } from "@/shared/lib/status"

export const scheduleKeys = {
  all: ["schedules"] as const,
  list: () => ["schedules", "list"] as const
}

/* -------------------------------------------------------------------------- */
/* Виды и группы                                                              */
/* -------------------------------------------------------------------------- */

export type ScheduleGroupKey = "search" | "apply" | "data" | "hh" | "messages"

export interface ScheduleGroup {
  readonly key: ScheduleGroupKey
  readonly label: string
  readonly kinds: ReadonlyArray<ScheduleKind>
}

/** Группы по назначению; порядок массива - порядок на странице. */
export const SCHEDULE_GROUPS: ReadonlyArray<ScheduleGroup> = [
  { key: "search", label: "Поиск вакансий", kinds: ["search", "source"] },
  { key: "apply", label: "Отклики", kinds: ["apply", "evaluate", "fit"] },
  { key: "data", label: "Данные", kinds: ["vacancy_hydration", "employer_hydration", "analysis"] },
  { key: "hh", label: "Аккаунт hh", kinds: ["resume_sync", "resume_bump", "hh_chat_sync"] },
  { key: "messages", label: "Почта и мессенджеры", kinds: ["mail_sync", "telegram_sync"] }
]

export interface ScheduleKindMeta {
  readonly group: ScheduleGroupKey
  /** Что делает расписание, обычными словами. */
  readonly description: string
  /** Можно ли создать вручную на странице расписаний. */
  readonly manual: boolean
  /** Где настраивается то, что вручную не создаётся. */
  readonly home: { readonly href: string; readonly text: string } | null
}

export const SCHEDULE_KIND_META: Record<ScheduleKind, ScheduleKindMeta> = {
  search: {
    group: "search",
    description: "Обходит выдачу hh.ru по ссылке и сохраняет новые вакансии.",
    manual: true,
    home: null
  },
  source: {
    group: "search",
    description: "Старый вид поиска: работает как обычный поиск по ссылке.",
    manual: false,
    home: null
  },
  apply: {
    group: "apply",
    description: "Готовит отклики, пишет письма и отправляет их по настройкам автооткликов.",
    manual: false,
    home: { href: "/auto-apply", text: "настраиваются на странице «Автоотклики»" }
  },
  evaluate: {
    group: "apply",
    description: "Проверяет вакансии фильтром откликов и решает, откликаться ли.",
    manual: false,
    home: { href: "/apply-filter", text: "создаётся вместе с фильтром откликов" }
  },
  fit: {
    group: "apply",
    description: "Просит модель оценить, насколько вакансии подходят резюме.",
    manual: false,
    home: { href: "/decisions", text: "создаётся вместе с оценкой соответствия" }
  },
  vacancy_hydration: {
    group: "data",
    description: "Догружает полные описания вакансий, которые найдены, но не открыты.",
    manual: true,
    home: null
  },
  employer_hydration: {
    group: "data",
    description: "Догружает профили компаний: рейтинг, сайт, логотип, отрасли.",
    manual: true,
    home: null
  },
  analysis: {
    group: "data",
    description: "Разбирает описания вакансий локальной моделью: роль, уровень, навыки.",
    manual: false,
    home: { href: "/hydration", text: "включается на странице «Догрузка данных»" }
  },
  resume_sync: {
    group: "hh",
    description: "Читает резюме с hh.ru, чтобы отклики шли с актуальным текстом.",
    manual: false,
    home: { href: "/resumes", text: "создаётся на странице «Резюме»" }
  },
  resume_bump: {
    group: "hh",
    description: "Поднимает опубликованные резюме в поиске, когда проходит срок отдыха.",
    manual: false,
    home: { href: "/resumes", text: "создаётся на странице «Резюме»" }
  },
  hh_chat_sync: {
    group: "hh",
    description: "Читает переписку по откликам в чатах hh.ru.",
    manual: false,
    home: { href: "/accounts", text: "создаётся при подключении аккаунта hh" }
  },
  mail_sync: {
    group: "messages",
    description: "Забирает письма рекрутеров с почтового ящика.",
    manual: true,
    home: { href: "/mail", text: "ящики добавляются на странице «Почта»" }
  },
  telegram_sync: {
    group: "messages",
    description: "Забирает сообщения рекрутеров из Telegram.",
    manual: true,
    home: { href: "/telegram", text: "аккаунты добавляются на странице «Telegram»" }
  }
}

/** Виды, которые пользователь создаёт вручную; порядок - порядок в форме. */
export const MANUAL_KINDS: ReadonlyArray<ScheduleKind> = [
  "search",
  "vacancy_hydration",
  "employer_hydration",
  "mail_sync",
  "telegram_sync"
]

/** Виды без собственной формы: создаются на своих страницах. */
export const OTHER_KINDS: ReadonlyArray<ScheduleKind> = SCHEDULE_GROUPS.flatMap((group) => group.kinds).filter(
  (kind) => !MANUAL_KINDS.includes(kind) && kind !== "source"
)

const KIND_ORDER: ReadonlyArray<ScheduleKind> = SCHEDULE_GROUPS.flatMap((group) => group.kinds)

export const isScheduleKind = (value: string): value is ScheduleKind =>
  (KIND_ORDER as ReadonlyArray<string>).includes(value)

export const scheduleGroupOf = (kind: ScheduleKind): ScheduleGroup =>
  SCHEDULE_GROUPS.find((group) => group.kinds.includes(kind)) ?? SCHEDULE_GROUPS[0]!

/** Короткое название вида: то же слово, что и на странице обзора. */
export const scheduleKindName = (kind: string): string => scheduleKindLabel(kind)

/** `source` редактируется формой поиска. */
export const formKindOf = (kind: ScheduleKind): ScheduleKind => (kind === "source" ? "search" : kind)

/* -------------------------------------------------------------------------- */
/* Цель расписания                                                            */
/* -------------------------------------------------------------------------- */

export interface TargetLookup {
  readonly mail: ReadonlyMap<string, string>
  readonly telegram: ReadonlyMap<string, string>
  readonly hhAccounts: ReadonlyMap<string, string>
  readonly resumes: ReadonlyMap<string, string>
}

export interface ScheduleTarget {
  /** Что читает пользователь: запрос поиска, адрес почты, аккаунт. */
  readonly text: string
  /** Ссылка на выдачу hh.ru для поисковых расписаний. */
  readonly url: string | null
}

const isGlobalTarget = (targetId: string): boolean => {
  const value = targetId.trim()
  return value === "" || value === "global" || value === "default"
}

/** Текст поиска из ссылки hh.ru: `text=iOS` → «iOS». */
export const searchQueryText = (url: string): string | null => {
  try {
    const text = new URL(url).searchParams.get("text")
    return text === null || text.trim() === "" ? null : text.trim()
  } catch {
    return null
  }
}

export const scheduleTarget = (
  schedule: Pick<CrawlSchedule, "kind" | "targetId">,
  lookup: TargetLookup
): ScheduleTarget => {
  const { kind, targetId } = schedule
  switch (kind) {
    case "search":
    case "source": {
      const url = formatSearchUrl(targetId)
      return { text: searchQueryText(targetId) ?? url, url }
    }
    case "mail_sync":
      return { text: lookup.mail.get(targetId) ?? "Почтовый ящик удалён", url: null }
    case "telegram_sync":
      return { text: lookup.telegram.get(targetId) ?? "Аккаунт Telegram удалён", url: null }
    case "fit":
      return {
        text: isGlobalTarget(targetId) ? "Активное резюме" : (lookup.resumes.get(targetId) ?? "Резюме"),
        url: null
      }
    case "apply":
    case "evaluate":
    case "resume_sync":
    case "resume_bump":
    case "hh_chat_sync":
      return {
        text: isGlobalTarget(targetId) ? "Все аккаунты hh" : (lookup.hhAccounts.get(targetId) ?? "Аккаунт hh"),
        url: null
      }
    default:
      return { text: "Весь корпус", url: null }
  }
}

/* -------------------------------------------------------------------------- */
/* Время                                                                      */
/* -------------------------------------------------------------------------- */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Через сколько после срока запуск ещё считается «ждёт worker», а не просроченным. */
export const OVERDUE_GRACE_MS = 90_000

/** «5 мин», «2 ч 5 мин», «3 д». Меньше минуты - «меньше минуты». */
export const spanText = (ms: number): string => {
  const value = Math.max(0, ms)
  if (value < MINUTE) return "меньше минуты"
  const minutes = Math.floor(value / MINUTE)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(value / HOUR)
  if (hours < 6) {
    const rest = minutes - hours * 60
    return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
  }
  if (hours < 48) return `${hours} ч`
  return `${Math.floor(value / DAY)} д`
}

/** «каждые 30 мин», «каждый час», «каждые 4 ч 5 мин», «раз в сутки». */
export const formatInterval = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "по запросу"
  const total = Math.round(minutes)
  if (total === 1) return "каждую минуту"
  if (total < 60) return `каждые ${total} мин`
  if (total % 1440 === 0) {
    const days = total / 1440
    return days === 1 ? "раз в сутки" : `каждые ${days} дн.`
  }
  if (total % 60 === 0) {
    const hours = total / 60
    return hours === 1 ? "каждый час" : `каждые ${hours} ч`
  }
  return `каждые ${Math.floor(total / 60)} ч ${total % 60} мин`
}

export interface Countdown {
  readonly text: string
  /** Срок прошёл настолько, что worker явно не успевает. */
  readonly overdue: boolean
}

/** «через 8 мин», «запускается», «просрочено на 5 мин». */
export const scheduleCountdown = (nextRunAt: string | null, now: number): Countdown | null => {
  if (nextRunAt === null) return null
  const at = Date.parse(nextRunAt)
  if (Number.isNaN(at)) return null
  const diff = at - now
  if (diff >= MINUTE) return { text: `через ${spanText(diff)}`, overdue: false }
  if (diff >= -OVERDUE_GRACE_MS) return { text: "запускается", overdue: false }
  return { text: `просрочено на ${spanText(-diff)}`, overdue: true }
}

/** «5 мин назад», «только что», «2 ч назад». */
export const formatAgo = (value: string | null | undefined, now: number): string | null => {
  if (value === null || value === undefined || value === "") return null
  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  const diff = now - at
  if (diff < MINUTE) return "только что"
  return `${spanText(diff)} назад`
}

/* -------------------------------------------------------------------------- */
/* Ошибки                                                                     */
/* -------------------------------------------------------------------------- */

export const hasScheduleError = (schedule: Pick<CrawlSchedule, "lastError">): boolean =>
  (schedule.lastError ?? "").trim() !== ""

/** Текст ошибки словами; сырой текст остаётся для подсказки. */
export const humanScheduleError = (raw: string): string => {
  const text = raw.toLowerCase()
  if (/captcha|капч/.test(text)) return "hh.ru показал капчу"
  if (/\b429\b|rate.?limit|too many/.test(text)) return "hh.ru ограничил частоту запросов"
  if (/\b403\b|forbidden/.test(text)) return "hh.ru отказал в доступе"
  if (/\b451\b|\bgeo/.test(text)) return "hh.ru недоступен из этого региона"
  if (/timeout|timed out|etimedout|econn|enotfound|fetch failed|network|socket|unreachable/.test(text)) {
    return "Нет связи с сервером"
  }
  if (/unauthori|\b401\b|auth|login|password|credential|session/.test(text)) return "Нужно войти в аккаунт заново"
  if (/invalidinput|target must|needs a .* account|must be/.test(text)) return "Расписание настроено неверно"
  if (/model|inference/.test(text)) return "Модель не ответила"
  return "Запуск завершился ошибкой"
}

/* -------------------------------------------------------------------------- */
/* Сводка, фильтры, группировка                                               */
/* -------------------------------------------------------------------------- */

export interface ScheduleSummary {
  readonly total: number
  readonly enabled: number
  readonly errors: number
  readonly running: number
}

export const summarizeSchedules = (
  schedules: ReadonlyArray<CrawlSchedule>,
  runningIds: ReadonlySet<string>
): ScheduleSummary => ({
  total: schedules.length,
  enabled: schedules.filter((schedule) => schedule.enabled).length,
  errors: schedules.filter(hasScheduleError).length,
  running: schedules.filter((schedule) => runningIds.has(schedule.id)).length
})

export interface ScheduleFilter {
  readonly group: ScheduleGroupKey | null
  /** Пустой список - любой вид. */
  readonly kinds: ReadonlyArray<ScheduleKind>
  readonly errorsOnly: boolean
  readonly disabledOnly: boolean
}

export const EMPTY_FILTER: ScheduleFilter = { group: null, kinds: [], errorsOnly: false, disabledOnly: false }

export const matchesFilter = (schedule: CrawlSchedule, filter: ScheduleFilter): boolean => {
  if (filter.group !== null && scheduleGroupOf(schedule.kind).key !== filter.group) return false
  if (filter.kinds.length > 0 && !filter.kinds.includes(schedule.kind)) return false
  if (filter.errorsOnly && !hasScheduleError(schedule)) return false
  if (filter.disabledOnly && schedule.enabled) return false
  return true
}

export interface ScheduleSection {
  readonly group: ScheduleGroup
  readonly items: ReadonlyArray<CrawlSchedule>
}

/** Группы в фиксированном порядке; внутри - по виду, затем по цели. Пустые группы не возвращаются. */
export const groupSchedules = (
  schedules: ReadonlyArray<CrawlSchedule>,
  targetText: (schedule: CrawlSchedule) => string
): ReadonlyArray<ScheduleSection> =>
  SCHEDULE_GROUPS.flatMap((group) => {
    const items = schedules
      .filter((schedule) => scheduleGroupOf(schedule.kind).key === group.key)
      .sort(
        (left, right) =>
          KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
          targetText(left).localeCompare(targetText(right), "ru")
      )
    return items.length === 0 ? [] : [{ group, items }]
  })

/**
 * Адрес страницы: `?kind=a,b`, `?group=data`, `?errors=1`, `?off=1`.
 * Незнакомые значения молча игнорируются.
 */
export const parseScheduleQuery = (search: string): ScheduleFilter => {
  const params = new URLSearchParams(search)
  const kinds = (params.get("kind") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(isScheduleKind)
  const group = params.get("group")
  return {
    group: SCHEDULE_GROUPS.find((candidate) => candidate.key === group)?.key ?? null,
    kinds,
    errorsOnly: params.get("errors") === "1",
    disabledOnly: params.get("off") === "1"
  }
}

export const scheduleQueryString = (filter: ScheduleFilter): string => {
  const params = new URLSearchParams()
  if (filter.kinds.length > 0) params.set("kind", filter.kinds.join(","))
  if (filter.group !== null) params.set("group", filter.group)
  if (filter.errorsOnly) params.set("errors", "1")
  if (filter.disabledOnly) params.set("off", "1")
  const text = params.toString()
  // Запятая в списке видов читается и без кодирования.
  return text === "" ? "" : `?${text.replaceAll("%2C", ",")}`
}

/** Короткая строка о состоянии одного расписания: «каждые 30 мин, следующий запуск через 4 мин». */
export const scheduleStateLine = (
  label: string,
  schedule: CrawlSchedule | undefined,
  now: number
): string => {
  if (schedule === undefined) return `${label}: расписания нет`
  if (!schedule.enabled) return `${label}: выключено`
  const parts = [formatInterval(schedule.intervalMinutes)]
  const countdown = scheduleCountdown(schedule.nextRunAt, now)
  if (countdown !== null) {
    parts.push(countdown.text.startsWith("через") ? `следующий запуск ${countdown.text}` : countdown.text)
  }
  if (hasScheduleError(schedule)) parts.push("последний запуск с ошибкой")
  return `${label}: ${parts.join(", ")}`
}

/* -------------------------------------------------------------------------- */
/* Проверка полей форм                                                        */
/* -------------------------------------------------------------------------- */

export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 10_080

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export const parseInterval = (raw: string): Parsed<number> => {
  const value = Number(raw)
  if (raw.trim() === "" || !Number.isInteger(value) || value < MIN_INTERVAL_MINUTES || value > MAX_INTERVAL_MINUTES) {
    return {
      ok: false,
      error: `Интервал: целое число минут от ${MIN_INTERVAL_MINUTES} до ${MAX_INTERVAL_MINUTES}.`
    }
  }
  return { ok: true, value }
}

/** Пустое поле - «не задано» (`null`), иначе целое число в границах. */
export const parseOptionalInt = (
  raw: string,
  title: string,
  min: number,
  max: number
): Parsed<number | null> => {
  if (raw.trim() === "") return { ok: true, value: null }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${title}: целое число от ${min} до ${max}.` }
  }
  return { ok: true, value }
}

export const parseSearchUrl = (raw: string): Parsed<string> => {
  const value = raw.trim()
  if (value === "") return { ok: false, error: "Вставьте ссылку на поиск hh.ru." }
  if (!/^https?:\/\//i.test(value)) return { ok: false, error: "Ссылка должна начинаться с http:// или https://." }
  try {
    new URL(value)
  } catch {
    return { ok: false, error: "Это не похоже на ссылку." }
  }
  return { ok: true, value }
}

/** Число из настроек расписания как строка для поля формы. */
export const optionText = (options: Readonly<Record<string, unknown>>, key: string): string => {
  const value = options[key]
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

/**
 * Настройки после правки формы: чужие ключи (например `proxyMode`) сохраняются,
 * `null` и пустая строка убирают ключ, чтобы вернуть значение по умолчанию.
 */
export const mergeOptions = (
  existing: Readonly<Record<string, unknown>> | undefined,
  updates: Readonly<Record<string, number | string | null>>
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") delete next[key]
    else next[key] = value
  }
  return next
}
