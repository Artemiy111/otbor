import { describe, expect, test } from "bun:test"
import { employerResponse, humanStatus, humanizeError, modeLabel } from "./status"

/** Фиксированное «сейчас»: время повтора печатается как «14:30» в тот же день. */
const now = new Date(2026, 10, 10, 12, 0, 0)
const at = (hours: number, minutes: number, day = 10) => new Date(2026, 10, day, hours, minutes, 0).toISOString()

describe("humanStatus", () => {
  test("состояния без причины", () => {
    expect(humanStatus({ state: "draft" }, null, now)).toMatchObject({ label: "Черновик", tone: "neutral", phase: "attention" })
    expect(humanStatus({ state: "submitted" }, null, now)).toMatchObject({ label: "Отправлен", tone: "success", phase: "sent" })
    expect(humanStatus({ state: "skipped" }, null, now)).toMatchObject({ label: "Пропущен", tone: "neutral", phase: "skipped" })
    expect(humanStatus({ state: "submitting" }, null, now)).toMatchObject({ label: "Отправляется", tone: "info", moving: true })
    expect(humanStatus({ state: "queued" }, null, now)).toMatchObject({ label: "В очереди на отправку", phase: "active" })
  })

  test("needs_human и failed несут причину второй строкой и в тексте", () => {
    const stopped = humanStatus({ state: "needs_human", blockedReason: "form_read_failed" }, null, now)
    expect(stopped).toMatchObject({ label: "Нужно ваше участие", tone: "warning", detail: "форма не прочитана", phase: "attention" })
    expect(stopped.text).toBe("Нужно ваше участие: форма не прочитана")
    expect(humanStatus({ state: "failed", blockedReason: "captcha" }, null, now)).toMatchObject({
      label: "Ошибка",
      tone: "danger",
      detail: "hh спросил капчу"
    })
    expect(humanStatus({ state: "failed" }, null, now).text).toBe("Ошибка")
  })

  test("preparing: этап автоотклика, лимит и повтор", () => {
    expect(humanStatus({ state: "preparing", autoRun: "auto" }, "reading_form", now).label).toBe("Читаем форму")
    expect(humanStatus({ state: "preparing", autoRun: "auto" }, "writing", now).label).toBe("Пишем письмо")
    expect(humanStatus({ state: "preparing", autoRun: "auto" }, "kit_ready", now).label).toBe("Готов к отправке")
    expect(humanStatus({ state: "preparing", autoRun: "auto" }, null, now).label).toBe("Готовим отклик")
    const capped = humanStatus({ state: "preparing", blockedReason: "daily_cap", retryAt: at(14, 30) }, null, now)
    expect(capped.label).toBe("Ждёт лимита до 14:30")
    expect(capped.tone).toBe("neutral")
    expect(capped.moving).toBe(true)
    const retry = humanStatus({ state: "preparing", blockedReason: "writing_failed", retryAt: at(15, 0) }, "blocked", now)
    expect(retry).toMatchObject({ label: "Повторим позже", tone: "warning" })
    expect(retry.detail).toBe("письмо не написано, в 15:00")
  })

  test("повтор в другой день называет дату", () => {
    expect(humanStatus({ state: "preparing", blockedReason: "daily_cap", retryAt: at(9, 5, 12) }, null, now).label).toContain("12 ноября")
  })

  test("неизвестное состояние не прячется", () => {
    expect(humanStatus({ state: "weird" }, null, now).label).toBe("weird")
  })
})

describe("employerResponse", () => {
  test("ответ работодателя отдельно от состояния", () => {
    expect(employerResponse({ state: "submitted", hhStatus: "VIEWED" })).toEqual({ label: "Просмотрен", tone: "info" })
    expect(employerResponse({ state: "submitted", hhStatus: "INTERVIEW" })?.label).toBe("Приглашение")
    expect(employerResponse({ state: "submitted", hhStatus: "DISCARD" })).toEqual({ label: "Отказ", tone: "danger" })
    expect(employerResponse({ state: "submitted", hhStatus: "RESPONSE" })?.label).toBe("Ждёт просмотра")
    expect(employerResponse({ state: "submitted", hhStatus: null })).toBeNull()
    expect(employerResponse({ state: "draft" })).toBeNull()
  })
})

describe("humanizeError и режим", () => {
  test("русский текст остаётся, английский сводится к фразе", () => {
    expect(humanizeError("Не удалось прочитать форму")).toBe("Не удалось прочитать форму")
    expect(humanizeError("hh asked for a captcha")).toBe("hh попросил капчу.")
    expect(humanizeError("request timed out after 30s")).toBe("hh слишком долго не отвечал.")
    expect(humanizeError("ECONNRESET")).toContain("Нет связи")
    expect(humanizeError("   ")).toBeNull()
    expect(humanizeError(null)).toBeNull()
    expect(humanizeError("xyzzy")).toContain("сбоем")
  })

  test("режим словами", () => {
    expect(modeLabel(null)).toBe("Вручную")
    expect(modeLabel("drafts")).toBe("Черновики")
    expect(modeLabel("auto")).toBe("Авто")
  })
})
