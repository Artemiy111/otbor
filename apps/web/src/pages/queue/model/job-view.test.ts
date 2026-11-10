import { describe, expect, test } from "bun:test"
import { jobDetail, jobError, jobRefs, jobTiming, jobTitle } from "./job-view"

const NOW = new Date("2026-11-10T12:00:00.000Z")

describe("jobTitle", () => {
  test("описывает задачу словами, а неизвестную стадию отдаёт как есть", () => {
    expect(jobTitle("form_read")).toBe("Чтение формы отклика")
    expect(jobTitle("something_new")).toBe("something_new")
  })
})

describe("jobRefs", () => {
  test("достаёт аккаунт, вакансию и отклик из payload", () => {
    expect(jobRefs({ payload: { hhAccountId: "a1", vacancyId: "v1", applicationId: "p1", resumeId: "r1" } })).toEqual({
      accountId: "a1",
      vacancyId: "v1",
      applicationId: "p1",
      resumeId: "r1"
    })
  })

  test("пустые и чужие значения дают null", () => {
    expect(jobRefs({ payload: { vacancyId: "", applicationId: 5 } })).toEqual({
      accountId: null,
      vacancyId: null,
      applicationId: null,
      resumeId: null
    })
    expect(jobRefs({ payload: null }).accountId).toBeNull()
    expect(jobRefs({ payload: ["x"] }).accountId).toBeNull()
  })
})

describe("jobDetail", () => {
  test("модель показывается только у генерации", () => {
    expect(jobDetail({ stage: "inference", payload: { model: "haiku" } })).toBe("модель haiku")
    expect(jobDetail({ stage: "submit", payload: { model: "haiku" } })).toBeNull()
  })
})

describe("jobError", () => {
  test("английский текст сводится к фразе, русский остаётся", () => {
    expect(jobError({ status: "failed", result: { message: "captcha required" } })).toBe("hh попросил капчу.")
    expect(jobError({ status: "dead", result: { exit: { message: "Форма изменилась" } } })).toBe("Форма изменилась")
  })

  test("у выполненного задания ошибки нет, даже если в результате есть message", () => {
    expect(jobError({ status: "done", result: { message: "captcha" } })).toBeNull()
    expect(jobError({ status: "failed", result: null })).toBeNull()
  })
})

describe("jobTiming", () => {
  test("ожидающее задание: сколько ждёт или когда запустится", () => {
    expect(jobTiming({ status: "pending", runAt: "2026-11-10T11:55:00.000Z", createdAt: "2026-11-10T11:00:00.000Z" }, NOW)).toBe(
      "ждёт 5 мин"
    )
    expect(jobTiming({ status: "pending", runAt: "2026-11-10T12:10:00.000Z", createdAt: "2026-11-10T11:00:00.000Z" }, NOW)).toBe(
      "запуск через 10 мин"
    )
  })

  test("выполняемое без аренды и завершённое", () => {
    expect(jobTiming({ status: "running", runAt: NOW.toISOString(), createdAt: NOW.toISOString() }, NOW)).toBe("идёт сейчас")
    expect(jobTiming({ status: "done", runAt: NOW.toISOString(), createdAt: "2026-11-10T10:00:00.000Z" }, NOW)).toBe(
      "создано 2 ч назад"
    )
  })
})
