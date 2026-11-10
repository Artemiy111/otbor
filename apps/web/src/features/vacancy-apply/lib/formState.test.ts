import { describe, expect, test } from "bun:test"
import { agoText, draftStateText, formStatus } from "./formState"

const NOW = new Date("2026-11-10T12:00:00Z")
const base = { hasTest: true, reading: false, stale: false, checkedAt: null, lastError: null } as const

describe("agoText", () => {
  test("минуты, часы, дни", () => {
    expect(agoText("2026-11-10T11:59:40Z", NOW)).toBe("только что")
    expect(agoText("2026-11-10T11:30:00Z", NOW)).toBe("30 мин назад")
    expect(agoText("2026-11-10T09:00:00Z", NOW)).toBe("3 ч назад")
    expect(agoText("2026-11-08T12:00:00Z", NOW)).toBe("2 дн. назад")
    expect(agoText(null, NOW)).toBeNull()
  })
})

describe("formStatus", () => {
  test("анкеты нет, ещё не читали и идёт чтение", () => {
    expect(formStatus({ ...base, form: null, hasTest: false }, NOW).text).toBe("Анкеты нет: достаточно письма")
    expect(formStatus({ ...base, form: null }, NOW)).toEqual({
      tone: "neutral",
      text: "Анкету ещё не читали",
      action: "read"
    })
    expect(formStatus({ ...base, form: null, reading: true }, NOW).action).toBeNull()
  })

  test("число вопросов, давность и устаревание", () => {
    const form = { questions: [1, 2, 3] }
    expect(formStatus({ ...base, form, checkedAt: "2026-11-10T09:00:00Z" }, NOW).text).toBe(
      "3 вопроса · прочитана 3 ч назад"
    )
    const old = formStatus({ ...base, form, stale: true, checkedAt: "2026-11-08T12:00:00Z" }, NOW)
    expect(old.text).toBe("3 вопроса · прочитана 2 дн. назад · устарела, обновите")
    expect(old.tone).toBe("warning")
    expect(old.action).toBe("refresh")
  })

  test("ошибка обновления не прячет старую анкету", () => {
    const status = formStatus({ ...base, form: { questions: [1] }, lastError: "captcha", checkedAt: "2026-11-10T11:00:00Z" }, NOW)
    expect(status.text).toBe("1 вопрос · прочитана 1 ч назад · обновить не удалось")
  })
})

describe("draftStateText", () => {
  test("несохранённое, сохранённое и пустое", () => {
    expect(draftStateText({ dirty: true, savedAt: null, now: NOW }).text).toBe("Есть несохранённые изменения")
    expect(draftStateText({ dirty: false, savedAt: "2026-11-10T11:00:00Z", now: NOW }).text).toBe(
      "Черновик сохранён 1 ч назад"
    )
    expect(draftStateText({ dirty: false, savedAt: null, now: NOW }).text).toBe("Черновика ещё нет")
  })
})
