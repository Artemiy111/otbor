import { describe, expect, test } from "bun:test"
import type { CaptchaAttemptReport } from "@otbor/contract"
import { Effect } from "effect"
import { CaptchaRecorder, makeCaptchaSolve } from "../src/browser/captcha.ts"

const config = {
  harnessId: "omlx",
  endpoint: { id: "omlx", url: "http://x/v1" },
  model: "gemma",
  maxAttempts: 2,
  timeoutSeconds: 5
}

/** Страница-двойник: после «Отправить» показывает то, что задал `after`. */
const fakePage = (after: string) => {
  const filled: Array<string> = []
  let submitted = false
  const locator = () => ({
    first: () => ({
      screenshot: async () => Buffer.from([1, 2, 3]),
      isVisible: async () => true,
      fill: async (text: string) => void filled.push(text),
      click: async () => void (submitted = true),
      press: async () => void (submitted = true)
    })
  })
  return {
    filled,
    page: {
      locator,
      content: async () => (submitted ? after : "<div>Подтвердите, что вы не робот</div>"),
      url: () => "https://hh.ru/applicant/vacancy_response"
    } as never
  }
}

const run = (after: string, ok = true) => {
  const { page, filled } = fakePage(after)
  const recorder: { attempts: Array<CaptchaAttemptReport> } = { attempts: [] }
  const solve = makeCaptchaSolve(
    () => config,
    () => Effect.succeed(ok ? { ok: true, text: "раёк", durationMs: 800, error: null } : { ok: false, text: null, durationMs: 50, error: "507" }),
    () => Effect.void
  )
  const result = Effect.runPromise(
    solve(page).pipe(Effect.provideService(CaptchaRecorder, recorder))
  )
  return { result, recorder, filled }
}

describe("captcha solver journal", () => {
  test("ответ принят: попытка solved, текст введён в поле", async () => {
    const { result, recorder, filled } = run("<div>Вы откликнулись</div>")
    expect(await result).toBe(true)
    expect(filled).toEqual(["раёк"])
    expect(recorder.attempts).toEqual([
      { harness: "omlx", model: "gemma", attempt: 1, answer: "раёк", outcome: "solved", durationMs: 800, error: null }
    ])
  })

  test("hh показал капчу снова: попытка rejected", async () => {
    const { result, recorder } = run("<div>Неверный текст. Пожалуйста, повторите</div>")
    expect(await result).toBe(true)
    expect(recorder.attempts[0]?.outcome).toBe("rejected")
  })

  test("модель не ответила: попытка error, ничего не введено", async () => {
    const { result, recorder, filled } = run("", false)
    expect(await result).toBe(false)
    expect(filled).toEqual([])
    expect(recorder.attempts[0]).toMatchObject({ outcome: "error", answer: null, error: "507" })
  })
})
