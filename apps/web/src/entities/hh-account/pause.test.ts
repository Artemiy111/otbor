import { describe, expect, test } from "bun:test"
import { describeSubmitPause, retryTimeText } from "./pause"

describe("describeSubmitPause", () => {
  test("старый сервер: причины нет или капча", () => {
    expect(describeSubmitPause({}).kind).toBe("captcha")
    expect(describeSubmitPause({ reason: "captcha", detail: null }).title).toBe("Пауза после капчи")
  })

  test("серия одинаковых отказов: понятный текст и сырая деталь отдельно", () => {
    const raw = `the resume "DevOps-инженер" (291000851) did not appear in hh's resume select`
    const view = describeSubmitPause({ reason: "repeated_failure", detail: raw })
    expect(view.title).toBe("Отправки остановлены: 5 раз подряд одна и та же ошибка")
    expect(view.humanError).toContain("Резюме не появилось")
    expect(view.rawDetail).toBe(raw)
  })

  test("без текста отказа", () => {
    const view = describeSubmitPause({ reason: "repeated_failure", detail: null })
    expect(view.humanError).toBeNull()
    expect(view.rawDetail).toBeNull()
  })
})

describe("retryTimeText", () => {
  test("пусто и мусор", () => {
    expect(retryTimeText(null)).toBeNull()
    expect(retryTimeText("не дата")).toBeNull()
  })
  test("сегодня только время, в другой день с датой", () => {
    const now = new Date(2026, 10, 12, 10, 0)
    expect(retryTimeText(new Date(2026, 10, 12, 16, 5).toISOString(), now)).toMatch(/^\d{2}:\d{2}$/)
    expect(retryTimeText(new Date(2026, 10, 13, 4, 5).toISOString(), now)).toContain("13 ноября")
  })
})
