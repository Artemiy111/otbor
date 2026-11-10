import { describe, expect, test } from "bun:test"
import { describeLogin, describeUsage, loginCommand, minutesUntil } from "./account-state"

const when = (iso: string) => `at ${iso}`
const session = (state: "ok" | "expired" | "blocked", lastError: string | null = null) => ({
  id: "acc-1" as never,
  session: { state, lastOkAt: "2026-11-01T10:00:00Z", lastError, updatedAt: "2026-11-01T10:00:00Z" }
})

describe("describeLogin", () => {
  test("без сессии: нейтральный тон и команда входа", () => {
    const view = describeLogin({ id: "acc-1" as never, session: null }, when)
    expect(view.tone).toBe("neutral")
    expect(view.command).toBe(loginCommand("acc-1"))
  })

  test("рабочая сессия: команда не нужна, видна последняя проверка", () => {
    const view = describeLogin(session("ok"), when)
    expect(view.tone).toBe("success")
    expect(view.command).toBeNull()
    expect(view.detail).toContain("at 2026-11-01T10:00:00Z")
  })

  test("истёкшая сессия: ошибка и команда в подсказке", () => {
    const view = describeLogin(session("expired", " 401 "), when)
    expect(view.tone).toBe("danger")
    expect(view.detail).toContain("Ошибка: 401")
    expect(view.command).toBe("otbor hh login --account acc-1")
  })

  test("блокировка отличается от истёкшей сессии", () => {
    expect(describeLogin(session("blocked"), when).label).not.toBe(describeLogin(session("expired"), when).label)
  })
})

describe("describeUsage", () => {
  test("тон по близости к лимиту", () => {
    expect(describeUsage({ used: 10, limit: 200 }).tone).toBe("success")
    expect(describeUsage({ used: 170, limit: 200 }).tone).toBe("warning")
    const full = describeUsage({ used: 200, limit: 200 })
    expect(full.tone).toBe("danger")
    expect(full.exhausted).toBe(true)
  })

  test("полоска не выходит за 100 %", () => {
    expect(describeUsage({ used: 250, limit: 200 }).percent).toBe(100)
  })
})

describe("minutesUntil", () => {
  test("округляет вверх, прошедшее и пустое даёт null", () => {
    const now = Date.parse("2026-11-01T10:00:00Z")
    expect(minutesUntil("2026-11-01T10:00:30Z", now)).toBe(1)
    expect(minutesUntil("2026-11-01T09:00:00Z", now)).toBeNull()
    expect(minutesUntil(null, now)).toBeNull()
  })
})
