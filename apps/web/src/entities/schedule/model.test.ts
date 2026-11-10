import { describe, expect, test } from "bun:test"
import type { CrawlSchedule } from "@otbor/contract"
import {
  EMPTY_FILTER,
  formatAgo,
  formatInterval,
  groupSchedules,
  humanScheduleError,
  matchesFilter,
  mergeOptions,
  parseInterval,
  parseScheduleQuery,
  parseSearchUrl,
  scheduleCountdown,
  scheduleQueryString,
  scheduleStateLine,
  scheduleTarget,
  summarizeSchedules,
  type TargetLookup
} from "./model"

const NOW = Date.parse("2026-11-10T10:00:00.000Z")
const at = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString()

const schedule = (patch: Partial<Record<keyof CrawlSchedule, unknown>>): CrawlSchedule =>
  ({
    id: "s1",
    kind: "search",
    targetId: "https://hh.ru/search/vacancy?text=iOS",
    intervalMinutes: 30,
    options: {},
    enabled: true,
    nextRunAt: at(8),
    lastRunAt: at(-22),
    lastError: null,
    createdAt: at(-1000),
    updatedAt: at(-1000),
    ...patch
  }) as CrawlSchedule

const lookup: TargetLookup = {
  mail: new Map([["m1", "work@example.com"]]),
  telegram: new Map(),
  hhAccounts: new Map([["a1", "Артём"]]),
  resumes: new Map()
}

describe("интервал", () => {
  test("словами", () => {
    expect(formatInterval(30)).toBe("каждые 30 мин")
    expect(formatInterval(1)).toBe("каждую минуту")
    expect(formatInterval(60)).toBe("каждый час")
    expect(formatInterval(120)).toBe("каждые 2 ч")
    expect(formatInterval(245)).toBe("каждые 4 ч 5 мин")
    expect(formatInterval(1440)).toBe("раз в сутки")
    expect(formatInterval(2880)).toBe("каждые 2 дн.")
    expect(formatInterval(0)).toBe("по запросу")
  })
})

describe("обратный отсчёт", () => {
  test("в будущем", () => {
    expect(scheduleCountdown(at(8), NOW)).toEqual({ text: "через 8 мин", overdue: false })
    expect(scheduleCountdown(at(125), NOW)?.text).toBe("через 2 ч 5 мин")
  })
  test("ожидает worker в пределах допуска", () => {
    expect(scheduleCountdown(at(0.5), NOW)).toEqual({ text: "запускается", overdue: false })
    expect(scheduleCountdown(at(-1), NOW)).toEqual({ text: "запускается", overdue: false })
  })
  test("просрочено", () => {
    expect(scheduleCountdown(at(-5), NOW)).toEqual({ text: "просрочено на 5 мин", overdue: true })
  })
  test("нет срока", () => {
    expect(scheduleCountdown(null, NOW)).toBeNull()
    expect(scheduleCountdown("мусор", NOW)).toBeNull()
  })
  test("давность", () => {
    expect(formatAgo(at(-22), NOW)).toBe("22 мин назад")
    expect(formatAgo(at(0), NOW)).toBe("только что")
    expect(formatAgo(null, NOW)).toBeNull()
  })
})

describe("цели", () => {
  test("поиск показывает запрос, а не ссылку", () => {
    expect(scheduleTarget(schedule({}), lookup).text).toBe("iOS")
  })
  test("почта и аккаунт hh", () => {
    expect(scheduleTarget(schedule({ kind: "mail_sync", targetId: "m1" }), lookup).text).toBe("work@example.com")
    expect(scheduleTarget(schedule({ kind: "apply", targetId: "global" }), lookup).text).toBe("Все аккаунты hh")
    expect(scheduleTarget(schedule({ kind: "apply", targetId: "a1" }), lookup).text).toBe("Артём")
  })
})

describe("группировка и фильтры", () => {
  const all = [
    schedule({ id: "1", kind: "mail_sync", targetId: "m1" }),
    schedule({ id: "2", kind: "search", targetId: "https://hh.ru/search/vacancy?text=b" }),
    schedule({ id: "3", kind: "search", targetId: "https://hh.ru/search/vacancy?text=a", lastError: "captcha" }),
    schedule({ id: "4", kind: "vacancy_hydration", targetId: "global", enabled: false }),
    schedule({ id: "5", kind: "apply", targetId: "global" })
  ]
  const text = (item: CrawlSchedule) => scheduleTarget(item, lookup).text
  const ids = (filter: Parameters<typeof matchesFilter>[1]): string[] =>
    all.flatMap((item) => (matchesFilter(item, filter) ? [item.id as string] : []))

  test("группы в фиксированном порядке, внутри по цели", () => {
    const sections = groupSchedules(all, text)
    expect(sections.map((section) => section.group.key)).toEqual(["search", "apply", "data", "messages"])
    expect(sections[0]?.items.map((item) => item.id as string)).toEqual(["3", "2"])
  })

  test("пустые группы не возвращаются", () => {
    expect(groupSchedules([], text)).toEqual([])
  })

  test("фильтры", () => {
    expect(ids({ ...EMPTY_FILTER, errorsOnly: true })).toEqual(["3"])
    expect(ids({ ...EMPTY_FILTER, disabledOnly: true })).toEqual(["4"])
    expect(ids({ ...EMPTY_FILTER, group: "data" })).toEqual(["4"])
    expect(ids({ ...EMPTY_FILTER, kinds: ["apply", "mail_sync"] })).toEqual(["1", "5"])
  })

  test("сводка", () => {
    expect(summarizeSchedules(all, new Set(["2"]))).toEqual({ total: 5, enabled: 4, errors: 1, running: 1 })
  })
})

describe("адрес страницы", () => {
  test("разбор и сборка", () => {
    const filter = parseScheduleQuery("?kind=vacancy_hydration,employer_hydration&errors=1")
    expect(filter.kinds).toEqual(["vacancy_hydration", "employer_hydration"])
    expect(filter.errorsOnly).toBe(true)
    expect(scheduleQueryString(filter)).toBe("?kind=vacancy_hydration,employer_hydration&errors=1")
    expect(scheduleQueryString(EMPTY_FILTER)).toBe("")
  })
  test("мусор игнорируется", () => {
    expect(parseScheduleQuery("?kind=nope&group=zzz&errors=2")).toEqual(EMPTY_FILTER)
    expect(parseScheduleQuery("?group=data").group).toBe("data")
  })
})

describe("строка состояния", () => {
  test("включено, выключено, нет", () => {
    expect(scheduleStateLine("Вакансии", schedule({ intervalMinutes: 30, nextRunAt: at(4) }), NOW)).toBe(
      "Вакансии: каждые 30 мин, следующий запуск через 4 мин"
    )
    expect(scheduleStateLine("Компании", schedule({ enabled: false }), NOW)).toBe("Компании: выключено")
    expect(scheduleStateLine("Компании", undefined, NOW)).toBe("Компании: расписания нет")
  })
})

describe("ошибки словами", () => {
  test("узнаёт частые причины", () => {
    expect(humanScheduleError("HTTP 429 Too Many Requests")).toBe("hh.ru ограничил частоту запросов")
    expect(humanScheduleError("captcha required")).toBe("hh.ru показал капчу")
    expect(humanScheduleError("fetch failed: ECONNREFUSED")).toBe("Нет связи с сервером")
    expect(humanScheduleError("что-то странное")).toBe("Запуск завершился ошибкой")
  })
})

describe("поля форм", () => {
  test("интервал", () => {
    expect(parseInterval("30")).toEqual({ ok: true, value: 30 })
    expect(parseInterval("4").ok).toBe(false)
    expect(parseInterval("").ok).toBe(false)
    expect(parseInterval("1.5").ok).toBe(false)
  })
  test("ссылка поиска", () => {
    expect(parseSearchUrl(" https://hh.ru/search/vacancy?text=a ")).toEqual({ ok: true, value: "https://hh.ru/search/vacancy?text=a" })
    expect(parseSearchUrl("hh.ru").ok).toBe(false)
    expect(parseSearchUrl("").ok).toBe(false)
  })
  test("настройки сохраняют чужие ключи и убирают очищенные", () => {
    expect(mergeOptions({ proxyMode: "direct", limit: 10 }, { limit: null, delayMs: 500 })).toEqual({
      proxyMode: "direct",
      delayMs: 500
    })
  })
})
