import { describe, expect, test } from "bun:test"
import {
  REPEATED_FAILURE_STREAK,
  decideRepeatedFailure,
  normalizeFailureMessage,
  repeatedFailureDelayMinutes
} from "../src/submitFailure.ts"

const msg = (id: number, name = "DevOps-инженер") => `the resume "${name}" (${id}) did not appear in hh's resume select`
const fail = (message: string | null, tag = "blocked") => ({ tag, message })
const times = (n: number, make: (i: number) => { tag: string; message: string | null }) =>
  Array.from({ length: n }, (_, i) => make(i))

describe("normalizeFailureMessage", () => {
  test("числа от 5 цифр и названия в кавычках не мешают сравнению", () => {
    expect(normalizeFailureMessage(msg(291000851))).toBe(normalizeFailureMessage(msg(123456, "Другое")))
    expect(normalizeFailureMessage("resume «Имя» 12345")).toBe("resume \"…\" #")
  })
  test("короткие числа сохраняются, пробелы схлопываются", () => {
    expect(normalizeFailureMessage("step 1234  failed")).toBe("step 1234 failed")
  })
  test("пустое сообщение", () => {
    expect(normalizeFailureMessage(null)).toBe("")
  })
})

describe("decideRepeatedFailure", () => {
  test("пять одинаковых blocked: пауза 6 часов и исходный текст", () => {
    const pause = decideRepeatedFailure(times(5, (i) => fail(msg(1000000 + i))))
    expect(pause?.delayMinutes).toBe(360)
    expect(pause?.detail).toBe(msg(1000000))
  })
  test("четыре - мало", () => {
    expect(decideRepeatedFailure(times(REPEATED_FAILURE_STREAK - 1, () => fail(msg(291000851))))).toBeNull()
  })
  test("успех внутри серии её обрывает", () => {
    const recent = [fail(msg(1)), fail(msg(1)), { tag: "submitted", message: null }, fail(msg(1)), fail(msg(1)), fail(msg(1))]
    expect(decideRepeatedFailure(recent)).toBeNull()
  })
  test("разные сообщения не складываются", () => {
    const recent = [...times(4, () => fail("the page changed")), fail("no resume select")]
    expect(decideRepeatedFailure(recent)).toBeNull()
  })
  test("исходы, привязанные к вакансии, не считаются", () => {
    for (const tag of ["answer_rejected", "form_changed", "already_responded", "vacancy_archived", "transport", "captcha"]) {
      expect(decideRepeatedFailure(times(8, () => fail("same", tag)))).toBeNull()
    }
  })
  test("resume_mismatch считается", () => {
    expect(decideRepeatedFailure(times(5, () => fail("form shows another resume", "resume_mismatch")))).not.toBeNull()
  })
  test("после автоснятия шестой отказ удваивает паузу до потолка", () => {
    const run = (n: number) => decideRepeatedFailure(times(n, () => fail("x")))?.delayMinutes
    expect([run(5), run(6), run(7), run(9)]).toEqual([360, 720, 1440, 1440])
    expect(repeatedFailureDelayMinutes(5)).toBe(360)
  })
})
