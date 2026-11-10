import type { Overview } from "@otbor/contract"
import { scheduleKindLabel } from "@/shared/lib/status"
import { applicationPath, vacancyPath } from "@/shared/lib/links"
import { plainError } from "./plain"

export type OverviewEvent = Overview["events"][number]
export type EventFilter = "all" | "applications" | "replies" | "problems" | "search"

export const EVENT_FILTERS: ReadonlyArray<{ readonly id: EventFilter; readonly label: string }> = [
  { id: "all", label: "Все" },
  { id: "applications", label: "Отклики" },
  { id: "replies", label: "Ответы работодателей" },
  { id: "problems", label: "Проблемы" },
  { id: "search", label: "Поиск" }
]

const FILTER_KINDS: Record<Exclude<EventFilter, "all">, ReadonlySet<string>> = {
  applications: new Set(["sent"]),
  replies: new Set(["invited", "rejected", "viewed"]),
  problems: new Set(["needs_human", "failed", "captcha", "crawl_error", "schedule_error"]),
  search: new Set(["crawl_done", "crawl_error"])
}

export const matchesFilter = (event: OverviewEvent, filter: EventFilter): boolean =>
  filter === "all" || FILTER_KINDS[filter].has(event.kind)

/** Короткое описание события по-русски; сырой текст ошибки на английском не показываем. */
export const eventLabel = (event: OverviewEvent): string => {
  switch (event.kind) {
    case "sent":
      return "Отклик отправлен"
    case "invited":
      return "Приглашение"
    case "rejected":
      return "Отказ"
    case "viewed":
      return "Просмотрен работодателем"
    case "needs_human":
      return "Нужно ваше участие"
    case "failed":
      return "Отклик не удался"
    case "crawl_done":
      return "Поиск завершён"
    case "crawl_error":
      return "Поиск не удался"
    case "schedule_error":
      return "Запуск не удался"
    case "captcha":
      return "hh попросил капчу"
  }
}

/** Заголовок: у schedule_error приходит сырой код вида расписания. */
export const eventTitle = (event: OverviewEvent): string =>
  event.kind === "schedule_error" ? scheduleKindLabel(event.title) : event.title

/** Вторая строка: работодатель, счётчики или понятная причина. */
export const eventSubtitle = (event: OverviewEvent): string | null => {
  const raw = event.subtitle
  if (raw === null || raw === "" || raw === "None") return null
  switch (event.kind) {
    case "needs_human":
    case "failed":
    case "crawl_error":
    case "schedule_error":
      return plainError(raw) ?? "подробности — в карточке"
    case "captcha":
      return raw.startsWith("после") ? `${raw}` : plainError(raw)
    default:
      return raw
  }
}

export const eventHref = (event: OverviewEvent): string | null => {
  if (event.applicationId !== null) return applicationPath(event.applicationId)
  if (event.vacancyId !== null) return vacancyPath(event.vacancyId)
  if (event.kind === "captcha") return "/accounts"
  if (event.kind === "crawl_done" || event.kind === "crawl_error" || event.kind === "schedule_error") {
    return "/schedules"
  }
  return null
}

export interface EventGroup {
  readonly key: string
  readonly label: string
  readonly isToday: boolean
  readonly events: ReadonlyArray<OverviewEvent>
}

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" })

/** События (свежие первыми) по календарным дням браузера: Сегодня / Вчера / «8 ноября». */
export const groupEvents = (events: ReadonlyArray<OverviewEvent>, now: number): ReadonlyArray<EventGroup> => {
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  const groups = new Map<string, { label: string; isToday: boolean; events: OverviewEvent[] }>()
  for (const event of events) {
    const date = new Date(event.at)
    if (Number.isNaN(date.getTime())) continue
    const key = dayKey(date)
    let group = groups.get(key)
    if (group === undefined) {
      const label =
        key === dayKey(today) ? "Сегодня" : key === dayKey(yesterday) ? "Вчера" : dayFormat.format(date)
      group = { label, isToday: key === dayKey(today), events: [] }
      groups.set(key, group)
    }
    group.events.push(event)
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }))
}
