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

/** Ответ модели: прочитала картинку. */
const read = (text: string) =>
  ({ ok: true, text, durationMs: 800, unavailable: false, error: null }) as const
/** Ответ модели: сервер жив, но текст не разобрала. */
const nothing = (error = "модель не вернула текст") =>
  ({ ok: false, text: null, durationMs: 50, unavailable: false, error }) as const
/** Харнес недоступен: повторять нечего. */
const down = (error = "HTTP 507: memory ceiling") =>
  ({ ok: false, text: null, durationMs: 50, unavailable: true, error }) as const

/** Страница-двойник: после «Отправить» показывает то, что задал `after`. */
const fakePage = (after: string) => {
  const filled: Array<string> = []
  let submitted = false
  // `src` картинки меняется при каждом чтении: так проверяется ожидание
  // подмены кадра после «Другой текст».
  let srcReads = 0
  const locator = () => ({
    first: () => ({
      screenshot: async () => Buffer.alloc(5_000, 1),
      getAttribute: async () => `src-${++srcReads}`,
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

const run = (input: {
  after: string
  answers: ReadonlyArray<ReturnType<typeof read> | ReturnType<typeof nothing> | ReturnType<typeof down>>
  maxAttempts?: number
}) => {
  const { page, filled } = fakePage(input.after)
  const recorder: { attempts: Array<CaptchaAttemptReport> } = { attempts: [] }
  let asked = 0
  const solve = makeCaptchaSolve(
    () => (input.maxAttempts === undefined ? config : { ...config, maxAttempts: input.maxAttempts }),
    () => {
      const answer = input.answers[Math.min(asked, input.answers.length - 1)]!
      asked += 1
      return Effect.succeed(answer)
    },
    () => Effect.void
  )
  const result = Effect.runPromise(
    solve(page).pipe(
      Effect.provideService(CaptchaRecorder, recorder),
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((error: Error) => Effect.succeed({ ok: false as const, message: error.message }))
    )
  )
  return { result, recorder, filled, asked: () => asked }
}

describe("captcha solver journal", () => {
  test("ответ принят: попытка solved, текст введён в поле", async () => {
    const { result, recorder, filled } = run({ after: "<div>Вы откликнулись</div>", answers: [read("раёк")] })
    expect(await result).toEqual({ ok: true, value: true })
    expect(filled).toEqual(["раёк"])
    expect(recorder.attempts).toEqual([
      { harness: "omlx", model: "gemma", filter: "none", attempt: 1, answer: "раёк", outcome: "solved", durationMs: 800, error: null }
    ])
  }, 20_000)

  test("hh показал капчу снова: попытка rejected", async () => {
    const { result, recorder } = run({
      after: "<div>Неверный текст. Пожалуйста, повторите</div>",
      answers: [read("раёк")],
      maxAttempts: 1
    })
    expect(await result).toEqual({ ok: true, value: true })
    expect(recorder.attempts[0]?.outcome).toBe("rejected")
  }, 20_000)

  test("фильтр включён, но картинка не PNG: уходит оригинал, в журнале none", async () => {
    const { page } = fakePage("<div>Вы откликнулись</div>")
    const recorder: { attempts: Array<CaptchaAttemptReport> } = { attempts: [] }
    const seen: Array<number> = []
    const solve = makeCaptchaSolve(
      () => ({ ...config, filter: "normalize" as const }),
      (_config, image) => {
        seen.push(image.byteLength)
        return Effect.succeed(read("x"))
      },
      () => Effect.void
    )
    await Effect.runPromise(solve(page).pipe(Effect.provideService(CaptchaRecorder, recorder)))
    expect(recorder.attempts[0]?.filter).toBe("none")
    expect(seen.length).toBe(1)
  }, 20_000)

  test("модель не ответила: попытки не тратятся, задача встаёт после трёх сбоев", async () => {
    const { result, recorder, filled, asked } = run({
      after: "",
      answers: [nothing("507")],
      maxAttempts: 5
    })
    expect(await result).toEqual({ ok: true, value: false })
    // Поле не заполнено ни разу, и модель спрашивали столько раз, сколько сбоев.
    expect(filled).toEqual([])
    expect(asked()).toBe(3)
    expect(recorder.attempts.map((item) => [item.attempt, item.outcome])).toEqual([
      [1, "error"],
      [1, "error"],
      [1, "error"]
    ])
  }, 20_000)
})

describe("captcha solver failures", () => {
  test("недоступный харнес: попытка не тратится, задача падает транспортом", async () => {
    const { result, recorder, filled, asked } = run({ after: "", answers: [down()], maxAttempts: 5 })
    const either = await result
    expect(either.ok).toBe(false)
    if (!either.ok) {
      expect(either.message).toContain("недоступен")
      expect(either.message).toContain("507")
    }
    // Один вызов модели и сразу выход: повторять нечем.
    expect(asked()).toBe(1)
    expect(filled).toEqual([])
    expect(recorder.attempts[0]).toMatchObject({ attempt: 1, outcome: "error", error: "HTTP 507: memory ceiling" })
  }, 20_000)

  test("сбой модели не тратит попытку: со второй попытки ответ всё-таки введён", async () => {
    const { result, recorder, filled } = run({
      after: "<div>Вы откликнулись</div>",
      answers: [nothing(), read("раёк")],
      maxAttempts: 1
    })
    expect(await result).toEqual({ ok: true, value: true })
    expect(filled).toEqual(["раёк"])
    expect(recorder.attempts.map((item) => [item.attempt, item.outcome])).toEqual([
      [1, "error"],
      [1, "solved"]
    ])
  }, 20_000)
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
        return Effect.succeed(read("x"))
      },
      () => Effect.void
    )
    expect(await Effect.runPromise(solve(page))).toBe(false)
    expect(asked).toBe(false)
  }, 20_000)
})
