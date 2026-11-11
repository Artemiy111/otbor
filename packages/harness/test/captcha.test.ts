import { describe, expect, test } from "bun:test"
import type { CaptchaAttemptReport } from "@otbor/contract"
import { Effect } from "effect"
import { CaptchaRecorder, makeCaptchaSolve } from "../src/browser/captcha.ts"

const config = {
  harnessId: "omlx",
  endpoint: { id: "omlx", url: "http://x/v1" },
  model: "gemma",
  maxAttempts: 2,
  timeoutSeconds: 5,
  filter: "none" as const
}

/** Страница-двойник: после «Отправить» показывает то, что задал `after`. */
const fakePage = (after: string) => {
  const filled: Array<string> = []
  let submitted = false
  const locator = () => ({
    first: () => ({
      screenshot: async () => Buffer.alloc(5_000, 1),
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
      { harness: "omlx", model: "gemma", filter: "none", attempt: 1, answer: "раёк", outcome: "solved", durationMs: 800, error: null }
    ])
  })

  test("hh показал капчу снова: попытка rejected", async () => {
    const { result, recorder } = run("<div>Неверный текст. Пожалуйста, повторите</div>")
    expect(await result).toBe(true)
    expect(recorder.attempts[0]?.outcome).toBe("rejected")
  })

  test("фильтр включён, но картинка не PNG: уходит оригинал, в журнале none", async () => {
    const { page } = fakePage("<div>Вы откликнулись</div>")
    const recorder: { attempts: Array<CaptchaAttemptReport> } = { attempts: [] }
    const seen: Array<number> = []
    const solve = makeCaptchaSolve(
      () => ({ ...config, filter: "normalize" as const }),
      (_config, image) => {
        seen.push(image.byteLength)
        return Effect.succeed({ ok: true, text: "x", durationMs: 1, error: null })
      },
      () => Effect.void
    )
    await Effect.runPromise(solve(page).pipe(Effect.provideService(CaptchaRecorder, recorder)))
    expect(recorder.attempts[0]?.filter).toBe("none")
    expect(seen.length).toBe(1)
  })

  test("модель не ответила: попытка error, ничего не введено", async () => {
    const { result, recorder, filled } = run("", false)
    expect(await result).toBe(false)
    expect(filled).toEqual([])
    expect(recorder.attempts[0]).toMatchObject({ outcome: "error", answer: null, error: "507" })
  })
})

describe("blank picture", () => {
  test("пустой кадр не отправляется модели", async () => {
    const { page } = fakePage("")
    const blank = page as unknown as { locator: () => { first: () => { screenshot: () => Promise<Buffer> } } }
    blank.locator = () => ({ first: () => ({ screenshot: async () => Buffer.alloc(450, 1) }) })
    let asked = false
    const solve = makeCaptchaSolve(
      () => config,
      () => {
        asked = true
        return Effect.succeed({ ok: true, text: "x", durationMs: 1, error: null })
      },
      () => Effect.void
    )
    expect(await Effect.runPromise(solve(page))).toBe(false)
    expect(asked).toBe(false)
  })
})
