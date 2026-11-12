import { AcpClient } from "@otbor/acp"
import {
  CAPTCHA_PROMPT,
  CAPTCHA_SOLVE_MAX_DELAY_SECONDS,
  CAPTCHA_SOLVE_MIN_DELAY_SECONDS,
  cleanCaptchaAnswer,
  loadCaptchaSolver,
  prepareCaptchaImage,
  recognizeCaptcha,
  type CaptchaRecognition,
  type CaptchaSolverConfig
} from "@otbor/local-models"
import type { CaptchaAttemptReport } from "@otbor/contract"
import { classifyResponsePage } from "@otbor/hh"
import { Context, Effect, Option, Stream } from "effect"
import type { Page } from "playwright"
import { selectModelAndEffort } from "../inference.ts"

/**
 * Сборщик попыток текущей задачи: `runJob` кладёт его в контекст на время
 * браузерной задачи, решатель дописывает попытки, а `complete` отправляет их
 * облаку, которое ведёт журнал. Нет сборщика (тесты) - попытки просто не копятся.
 */
export class CaptchaRecorder extends Context.Service<
  CaptchaRecorder,
  { readonly attempts: Array<CaptchaAttemptReport> }
>()("otbor/harness/CaptchaRecorder") {}

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

/**
 * Кнопка «обновить картинку»: после неверного ответа берём новую капчу, а не
 * бьёмся о ту же. Запасной вариант - первая кнопка после картинки (под ней
 * стоит именно обновление). Селектор подтверждён только по скриншоту hh.
 */
const CAPTCHA_REFRESH_SELECTORS = [
  '[data-qa="account-captcha-refresh"]',
  '[data-qa="account-captcha-reload"]',
  `${CAPTCHA_PICTURE_SELECTOR} >> xpath=following::button[1]`
]

/**
 * Однотонный PNG такого размера весит сотни байт, настоящая капча - десятки
 * килобайт. Порог с большим запасом: пустой кадр от картинки он отличает точно.
 */
export const BLANK_PICTURE_BYTES = 3_000
export const isBlankPicture = (png: Uint8Array): boolean => png.byteLength < BLANK_PICTURE_BYTES
const BLANK_RETRIES = 8
const BLANK_RETRY_MS = 500

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

      // Повторная попытка на той же капче: просим у hh новую картинку.
      if (used > 0) {
        const refreshed = yield* Effect.tryPromise(async () => {
          const button = await firstVisible(page, CAPTCHA_REFRESH_SELECTORS)
          if (button === null) return false
          await button.click({ timeout: 5_000 })
          return true
        }).pipe(Effect.orElseSucceed(() => false))
        if (refreshed) yield* Effect.sleep("1500 millis")
        else yield* Effect.logWarning("captcha: refresh button not found, retrying on the same picture")
      }

      const picture = page.locator(CAPTCHA_PICTURE_SELECTOR).first()
      // Картинка дорисовывается после появления окна: скриншот раньше времени
      // даёт белый прямоугольник. Пробуем несколько раз, пустой не отправляем.
      // Пока картинка не загрузилась, браузер рисует значок «битой картинки» с
      // подписью `captcha`: он не белый, проходит проверку на пустоту и съедает
      // попытку модели. Ждём до ~4 с, пока `<img>` реально загрузится.
      for (let waited = 0; waited < 4_000; waited += 250) {
        const loaded = yield* Effect.tryPromise(() =>
          picture.evaluate((node) => {
            const img = node instanceof HTMLImageElement ? node : node.querySelector("img")
            return img === null ? true : img.complete && img.naturalWidth > 0
          }, undefined, { timeout: 2_000 })
        ).pipe(Effect.orElseSucceed(() => true))
        if (loaded) break
        yield* Effect.sleep("250 millis")
      }
      let image: Buffer | null = null
      for (let tryNo = 0; tryNo < BLANK_RETRIES && image === null; tryNo++) {
        const shot = yield* Effect.tryPromise(() => picture.screenshot({ type: "png", timeout: 5_000 })).pipe(
          Effect.orElseSucceed(() => null)
        )
        if (shot !== null && !isBlankPicture(shot)) image = shot
        else if (tryNo < BLANK_RETRIES - 1) yield* Effect.sleep(`${BLANK_RETRY_MS} millis`)
      }
      if (image === null) {
        yield* Effect.logWarning("captcha: picture not found or still blank, nothing to recognise")
        return false
      }

      const recorder = yield* Effect.serviceOption(CaptchaRecorder)
      // Фильтр картинки: что именно увидела модель, пишем в журнал.
      const prepared = yield* Effect.promise(() => prepareCaptchaImage(image!, config.filter))
      const note = (
        outcome: CaptchaAttemptReport["outcome"],
        answer: string | null,
        durationMs: number,
        error: string | null
      ) => {
        if (Option.isSome(recorder)) {
          recorder.value.attempts.push({
            harness: config.harnessId,
            model: config.model,
            filter: prepared.filter,
            attempt: used + 1,
            answer,
            outcome,
            durationMs,
            error
          })
        }
      }

      const result = yield* recognize(config, prepared.image)
      if (!result.ok || result.text === null) {
        note("error", null, result.durationMs, result.error)
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
        note("error", text, result.durationMs, "answer field not found on the page")
        yield* Effect.logWarning("captcha: answer field not found on the page")
        return false
      }

      yield* Effect.logInfo(
        `captcha: answered "${text}" with ${config.harnessId}/${config.model} filter=${prepared.filter} in ${result.durationMs} ms (attempt ${used + 1}/${config.maxAttempts})`
      )
      yield* Effect.sleep(`${AFTER_SUBMIT_MS} millis`)
      // Приняла ли hh ответ: капча на странице осталась - значит, нет.
      const html = yield* Effect.tryPromise(() => page.content()).pipe(Effect.orElseSucceed(() => null as string | null))
      const rejected = html !== null && classifyResponsePage(html, page.url()) === "captcha"
      note(rejected ? "rejected" : "solved", text, result.durationMs, null)
      return true
    })
}
