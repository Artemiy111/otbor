import { AcpClient } from "@otbor/acp"
import {
  CAPTCHA_PROMPT,
  CAPTCHA_SOLVE_MAX_DELAY_SECONDS,
  CAPTCHA_SOLVE_MIN_DELAY_SECONDS,
  cleanCaptchaAnswer,
  loadCaptchaSolver,
  recognizeCaptcha,
  type CaptchaRecognition,
  type CaptchaSolverConfig
} from "@otbor/local-models"
import { Effect, Stream } from "effect"
import type { Page } from "playwright"
import { selectModelAndEffort } from "../inference.ts"

/** Картинка капчи на странице hh (тот же селектор, что у отладочного снимка). */
export const CAPTCHA_PICTURE_SELECTOR = '[data-qa="account-captcha-picture"]'
const CAPTCHA_INPUT_SELECTORS = [
  '[data-qa="account-captcha-input"]',
  'input[placeholder*="картинки" i]',
  'input[placeholder*="text" i]'
]
const CAPTCHA_SUBMIT_SELECTORS = [
  '[data-qa="account-captcha-submit"]',
  'button:has-text("Отправить")',
  'button:has-text("Submit")'
]

/** Сколько ждать после «Отправить», пока hh примет ответ или покажет новую капчу. */
const AFTER_SUBMIT_MS = 2_500

/**
 * Прочитать картинку выбранным харнесом. Харнес — любой из каталога: локальный
 * сервер с OpenAI API идёт прямым запросом, остальные (`opencode`, `claude`, ...)
 * — через ACP-сессию, где картинка отправляется блоком `image`. Тест подменяет.
 */
export type CaptchaRecognize = (
  config: CaptchaSolverConfig,
  image: Uint8Array
) => Effect.Effect<CaptchaRecognition>

export const recognizeWithHarness: CaptchaRecognize = (config, image) =>
  config.endpoint !== null
    ? Effect.promise(() => recognizeCaptcha({ ...config, endpoint: config.endpoint! }, image))
    : Effect.gen(function*() {
      const started = Date.now()
      const acp = yield* AcpClient
      yield* selectModelAndEffort(acp, { harness: config.harnessId, model: config.model })
      const events = yield* Stream.runCollect(
        acp.promptEvents(CAPTCHA_PROMPT, [{ data: Buffer.from(image).toString("base64"), mimeType: "image/png" }])
      )
      const done = Array.from(events).find((event) => event._tag === "Done")
      const text = done === undefined ? "" : cleanCaptchaAnswer(done.text)
      return text === ""
        ? { ok: false, text: null, durationMs: Date.now() - started, error: "агент не вернул текст" }
        : { ok: true, text, durationMs: Date.now() - started, error: null } satisfies CaptchaRecognition
    }).pipe(
      Effect.timeoutOrElse({
        duration: `${config.timeoutSeconds} seconds`,
        orElse: () => Effect.fail(new Error(`нет ответа за ${config.timeoutSeconds} с`))
      }),
      Effect.catch((error) =>
        Effect.succeed<CaptchaRecognition>({
          ok: false,
          text: null,
          durationMs: 0,
          error: error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)
        })
      ),
      // Один процесс агента на попытку: закрывается вместе со скоупом.
      Effect.scoped,
      Effect.provide(AcpClient.layerFor(config.harnessId)),
      Effect.catchCause((cause) =>
        Effect.succeed<CaptchaRecognition>({ ok: false, text: null, durationMs: 0, error: `агент недоступен: ${String(cause).slice(0, 200)}` })
      )
    )

/**
 * Решатель капчи для страницы: картинку снимает сама страница (байты остаются в
 * памяти), выбранный харнес читает текст, браузер вводит его и жмёт «Отправить».
 * Возвращает `true`, если ответ введён и стоит перечитать страницу, и `false`,
 * когда решать нечем или попытки кончились: тогда задача завершается выходом
 * `captcha`, как раньше. Что капча решена, определяет только то, что страница
 * больше её не показывает.
 */
export type CaptchaSolve = (page: Page) => Effect.Effect<boolean>

export const makeCaptchaSolve = (
  load: () => CaptchaSolverConfig | null = loadCaptchaSolver,
  recognize: CaptchaRecognize = recognizeWithHarness,
  pause: (seconds: number) => Effect.Effect<void> = (seconds) => Effect.sleep(`${seconds * 1000} millis`)
): CaptchaSolve => {
  /** Сколько ответов уже введено на этой странице. */
  const attempts = new WeakMap<Page, number>()

  const firstVisible = async (page: Page, selectors: ReadonlyArray<string>) => {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if (await locator.isVisible().catch(() => false)) return locator
    }
    return null
  }

  return (page) =>
    Effect.gen(function*() {
      const config = load()
      if (config === null) return false
      const used = attempts.get(page) ?? 0
      if (used >= config.maxAttempts) return false
      attempts.set(page, used + 1)

      const picture = page.locator(CAPTCHA_PICTURE_SELECTOR).first()
      const image = yield* Effect.tryPromise(() => picture.screenshot({ type: "png", timeout: 5_000 })).pipe(
        Effect.orElseSucceed(() => null)
      )
      if (image === null) {
        yield* Effect.logWarning("captcha: picture not found on the page, nothing to recognise")
        return false
      }

      const result = yield* recognize(config, image)
      if (!result.ok || result.text === null) {
        yield* Effect.logWarning(`captcha: ${config.harnessId}/${config.model} failed: ${result.error}`)
        return false
      }
      const text = result.text

      // Человек не отвечает мгновенно: добираем паузу до 10-15 секунд.
      const target = CAPTCHA_SOLVE_MIN_DELAY_SECONDS +
        Math.random() * (CAPTCHA_SOLVE_MAX_DELAY_SECONDS - CAPTCHA_SOLVE_MIN_DELAY_SECONDS)
      const remaining = target - result.durationMs / 1000
      if (remaining > 0) yield* pause(remaining)

      const typed = yield* Effect.tryPromise(async () => {
        const input = await firstVisible(page, CAPTCHA_INPUT_SELECTORS)
        if (input === null) return false
        await input.fill(text, { timeout: 5_000 })
        const submit = await firstVisible(page, CAPTCHA_SUBMIT_SELECTORS)
        if (submit === null) await input.press("Enter")
        else await submit.click({ timeout: 5_000 })
        return true
      }).pipe(Effect.orElseSucceed(() => false))
      if (!typed) {
        yield* Effect.logWarning("captcha: answer field not found on the page")
        return false
      }

      yield* Effect.logInfo(
        `captcha: answered "${text}" with ${config.harnessId}/${config.model} in ${result.durationMs} ms (attempt ${used + 1}/${config.maxAttempts})`
      )
      yield* Effect.sleep(`${AFTER_SUBMIT_MS} millis`)
      return true
    })
}
