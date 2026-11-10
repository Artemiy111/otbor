import { describe, expect, test } from "bun:test"
import type { OverviewEvent } from "./events"
import { eventHref, eventSubtitle, eventTitle, groupEvents, matchesFilter } from "./events"
import { runningPhrases, upcomingRuns } from "./activity"
import { NOW } from "./overview.fixture"

const event = (patch: Partial<OverviewEvent>): OverviewEvent =>
  ({ at: new Date(NOW).toISOString(), kind: "sent", title: "Vacancy", subtitle: null, vacancyId: null, applicationId: null, hhAccountId: null, ...patch }) as OverviewEvent

describe("события", () => {
  test("фильтры по видам", () => {
    expect(matchesFilter(event({ kind: "sent" }), "applications")).toBe(true)
    expect(matchesFilter(event({ kind: "invited" }), "replies")).toBe(true)
    expect(matchesFilter(event({ kind: "captcha" }), "problems")).toBe(true)
    expect(matchesFilter(event({ kind: "crawl_done" }), "search")).toBe(true)
    expect(matchesFilter(event({ kind: "sent" }), "problems")).toBe(false)
    expect(matchesFilter(event({ kind: "sent" }), "all")).toBe(true)
  })

  test("schedule_error: код расписания заменяется русским названием", () => {
    expect(eventTitle(event({ kind: "schedule_error", title: "vacancy_hydration" }))).toBe("Догрузка вакансий")
  })

  test("сырой английский текст ошибки не показывается", () => {
    expect(eventSubtitle(event({ kind: "needs_human", subtitle: "hh asked for a captcha" }))).toBe("hh попросил капчу")
    expect(eventSubtitle(event({ kind: "schedule_error", subtitle: "fetch https://hh.ru/x: ECONNRESET" }))).toBe("сбой сети")
    expect(eventSubtitle(event({ kind: "failed", subtitle: "weird unknown thing" }))).toBe("подробности — в карточке")
    expect(eventSubtitle(event({ kind: "captcha", subtitle: "None" }))).toBeNull()
  })

  test("ссылки: заявка важнее вакансии, у капчи — аккаунты", () => {
    expect(eventHref(event({ applicationId: "a1" as never, vacancyId: "v1" as never }))).toBe("/applications/a1")
    expect(eventHref(event({ vacancyId: "v1" as never }))).toBe("/vacancies/v1")
    expect(eventHref(event({ kind: "captcha" }))).toBe("/accounts")
    expect(eventHref(event({ kind: "sent" }))).toBeNull()
  })

  test("группы по дням: Сегодня и Вчера", () => {
    const today = event({ at: new Date(NOW).toISOString() })
    const yesterday = event({ at: new Date(NOW - 24 * 3600_000).toISOString() })
    const groups = groupEvents([today, yesterday], NOW)
    expect(groups.map((group) => group.label)).toEqual(["Сегодня", "Вчера"])
    expect(groups[0]?.isToday).toBe(true)
  })
})

describe("активность", () => {
  test("работа исполнителя человеческими фразами", () => {
    expect(
      runningPhrases([
        { stage: "form_read", count: 2 },
        { stage: "submit", count: 1 },
        { stage: "letter_attach", count: 5 }
      ])
    ).toEqual(["читает 2 формы", "отправляет 1 отклик", "пишет 5 писем"])
  })

  test("ближайшие запуски по времени, выключенные и идущие не показываются", () => {
    const schedule = (id: string, minutes: number, enabled = true) =>
      ({ id, kind: "mail_sync", targetId: "", enabled, nextRunAt: new Date(NOW + minutes * 60_000).toISOString() }) as never
    const rows = upcomingRuns(
      [schedule("b", 30), schedule("a", 5), schedule("off", 1, false), schedule("busy", 2)],
      [{ scheduleId: "busy", status: "running" } as never],
      NOW,
      3
    )
    expect(rows.map((row) => row.id)).toEqual(["a", "b"])
    expect(rows[0]?.when).toBe("через 5 мин")
  })
})
