import { describe, expect, test } from "bun:test"
import type { ScheduleRun } from "@otbor/contract"
import { indexRuns, insertedTrend, runProgressText, runResultText } from "./model"

const run = (patch: Partial<Record<keyof ScheduleRun, unknown>>): ScheduleRun =>
  ({ id: "r", scheduleId: "s1", kind: "search", status: "done", startedAt: "2026-11-10T10:00:00.000Z", ...patch }) as ScheduleRun

describe("итог запуска словами", () => {
  test("поиск", () => {
    expect(runResultText("search", { found: 340, inserted: 12, updated: 3, skipped: 0 })).toBe("+12 новых вакансий, найдено 340")
    expect(runResultText("search", { found: 20, inserted: 1 })).toBe("+1 новая вакансия, найдено 20")
    expect(runResultText("search", { found: 20, inserted: 0, evaluated: 4 })).toBe("новых вакансий нет, найдено 20, оценено 4")
  })
  test("догрузка", () => {
    expect(runResultText("vacancy_hydration", { processed: 25, hydrated: 22, failed: 3 })).toBe("догружено 22 вакансии, 3 ошибки")
    expect(runResultText("vacancy_hydration", { processed: 0 })).toBe("догружать нечего")
    expect(runResultText("employer_hydration", { processed: 5, updated: 5, stoppedBy: "captcha" })).toBe(
      "обновлено 5 компаний, остановлен: капча hh.ru"
    )
  })
  test("почта и Telegram", () => {
    expect(runResultText("mail_sync", { processed: 40, inserted: 2, contacts: 1 })).toBe("+2 новых письма, контактов: 1")
    expect(runResultText("telegram_sync", { processed: 10, inserted: 0 })).toBe("нового нет")
  })
  test("отклики, оценка, резюме", () => {
    expect(runResultText("apply", { selected: 3, created: 2, submitQueued: 1, needsHuman: 0 })).toBe("создано 2 отклика, на отправку 1")
    expect(runResultText("apply", { selected: 0, created: 0 })).toBe("откликать нечего")
    expect(runResultText("evaluate", { evaluated: 10, apply: 2 })).toBe("оценено 10, откликаться: 2")
    expect(runResultText("resume_bump", { queued: 0, candidates: 0 })).toBe("подъём не нужен")
    expect(runResultText("analysis", { disabled: true })).toBe("анализ выключен в настройках")
  })
  test("пусто, если сказать нечего", () => {
    expect(runResultText("search", null)).toBe("")
    expect(runResultText("search", {})).toBe("")
  })
  test("неизвестный вид падает на общие счётчики", () => {
    expect(runResultText("other", { analysed: 2, skipped: 3 })).toBe("проанализировано 2, пропущено 3")
  })
})

describe("ход запуска", () => {
  test("обработано из", () => {
    expect(runProgressText({ processed: 3, target: 25 })).toBe("обработано 3 из 25")
    expect(runProgressText({ processed: 0 })).toBe("")
    expect(runProgressText(undefined)).toBe("")
  })
})

describe("индекс запусков", () => {
  test("последний законченный и идущий по расписанию", () => {
    const index = indexRuns([
      run({ id: "old", startedAt: "2026-11-10T08:00:00.000Z" }),
      run({ id: "new", startedAt: "2026-11-10T09:00:00.000Z" }),
      run({ id: "live", status: "running", startedAt: "2026-11-10T10:00:00.000Z" }),
      run({ id: "other", scheduleId: "s2", status: "error" })
    ])
    expect(index.latest.get("s1")?.id as string | undefined).toBe("new")
    expect(index.running.get("s1")?.id as string | undefined).toBe("live")
    expect(index.latest.get("s2")?.id as string | undefined).toBe("other")
  })
  test("тренд: старые слева", () => {
    const runs = [
      run({ id: "a", startedAt: "2026-11-10T08:00:00.000Z", detail: { inserted: 5 } }),
      run({ id: "b", startedAt: "2026-11-10T09:00:00.000Z", detail: { inserted: 0 } }),
      run({ id: "c", startedAt: "2026-11-10T09:30:00.000Z", status: "error" })
    ]
    expect(insertedTrend(runs, "s1")).toEqual([5, 0])
  })
})
