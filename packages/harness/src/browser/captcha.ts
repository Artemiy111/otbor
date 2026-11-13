import { AcpClient } from "@otbor/acp"
import {
  CAPTCHA_PROMPT,
  CAPTCHA_SOLVE_MAX_DELAY_SECONDS,
  CAPTCHA_SOLVE_MIN_DELAY_SECONDS,
  cleanCaptchaAnswer,
  loadCaptchaSolver,
  prepareCaptchaImage,
  recognizeCaptcha,
  type CaptchaFilter,
  type CaptchaRecognition,
  type CaptchaSolverConfig
} from "@otbor/local-models"
import type { CaptchaAttemptReport } from "@otbor/contract"
import { classifyResponsePage } from "@otbor/hh"
import { Context, Effect, Option, Stream } from "effect"
import type { Locator, Page } from "playwright"
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
 * Кнопка «Другой текст»: после неверного ответа берём новую капчу, а не бьёмся
 * о ту же. Настоящий селектор - `captcha-renew-text` (сверено по
 * `repos/hh/captcha.html`). Запасной вариант - первая кнопка после картинки, но
 * только не submit: иначе промах селектора отправил бы старый ответ заново.
 */
const CAPTCHA_REFRESH_SELECTORS = [
  '[data-qa="captcha-renew-text"]',
  `${CAPTCHA_PICTURE_SELECTOR} >> xpath=following::button[not(@type="submit")][1]`
]

/**
 * Однотонный PNG такого размера весит сотни байт, настоящая капча - десятки
 * килобайт. Порог с большим запасом: пустой кадр от картинки он отличает точно.
 */
export const BLANK_PICTURE_BYTES = 3_000
export const isBlankPicture = (png: Uint8Array): boolean => png.byteLength < BLANK_PICTURE_BYTES
const BLANK_RETRIES = 8
const BLANK_RETRY_MS = 500

/**
 * Сколько раз подряд можно не дойти до ввода ответа (картинка не отрисовалась,
 * модель ничего не прочитала, поля ответа нет). Это не попытки: ответ не был
 * введён, значит и попытка не израсходована. Ограничение нужно, чтобы задача не
 * висела на сломанной странице или модели.
 */
export const CAPTCHA_STALL_LIMIT = 3

/** Сколько ждём поле ответа, пока страница его дорисует. */
const CAPTCHA_FIELD_WAIT_MS = 3_000

/** Сколько ждать после «Отправить», пока hh примет ответ или покажет новую капчу. */
const AFTER_SUBMIT_MS = 2_500

/**
 * Последняя причина, по которой решатель не справился, по странице: её
 * дописывает `withCaptchaShot` к сообщению выхода `captcha`, поэтому причина
 * видна в журнале задач, в логе и в следе страницы, а не только внутри попыток.
 */
const failures = new WeakMap<Page, string>()
export const lastCaptchaFailure = (page: Page): string | null => failures.get(page) ?? null

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
        ? { ok: false, text: null, durationMs: Date.now() - started, unavailable: false, error: "агент не вернул текст" }
        : { ok: true, text, durationMs: Date.now() - started, unavailable: false, error: null } satisfies CaptchaRecognition
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
          unavailable: true,
          error: error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)
        })
      ),
      // Один процесс агента на попытку: закрывается вместе со скоупом.
      Effect.scoped,
      Effect.provide(AcpClient.layerFor(config.harnessId)),
      Effect.catchCause((cause) =>
        Effect.succeed<CaptchaRecognition>({
          ok: false,
          text: null,
          durationMs: 0,
          unavailable: true,
          error: `агент недоступен: ${String(cause).slice(0, 200)}`
        })
      )
    )

/**
 * Решатель капчи для страницы. `true` - ответ введён, страницу надо перечитать;
 * `false` - решать больше нечем; `Effect.fail` - решатель недоступен (задача
 * станет `transport`, а не `captcha`).
 */
export type CaptchaSolve = (page: Page) => Effect.Effect<boolean, Error>

/**
 * Состояния одной капчи на одной странице.
 *
 *   ┌─ ВЫКЛЮЧЕН ─ решатель не настроен (load -> null) ───────────► false
 *   ├─ ИСЧЕРПАН ─ ответов уже введено >= maxAttempts ─────────────► false
 *   └─ ЦИКЛ ── пока ответов < maxAttempts и сбоев < CAPTCHA_STALL_LIMIT
 *
 *        ┌──────────────── ПОВТОР? ─────────────┐
 *     нет│                                     да│ нажать «Другой текст»
 *        │                                       │ и дождаться смены src
 *        ▼                                       ▼
 *   ┌─────────────┐  картинки нет / белая  ┌───────────────────┐
 *   │ СНЯТЬ КАДР  │───────────────────────►│ СБОЙ КАРТИНКИ     │ сбой +1,
 *   └──────┬──────┘                        └───────────────────┘ к началу
 *          │ PNG
 *          ▼
 *   ┌─────────────┐  харнес недоступен    ┌───────────────────┐
 *   │ РАСПОЗНАТЬ  │───────────────────────►│ РЕШАТЕЛЬ ЛЕЖИТ    │ fail ->
 *   └──────┬──────┘                        └───────────────────┘ transport
 *          │ текст
 *          ├────────── пустой ответ ──────► СБОЙ МОДЕЛИ: сбой +1, к началу
 *          ▼
 *   ┌─────────────┐  поля/кнопки нет      ┌───────────────────┐
 *   │ ПАУЗА 10-15 │───────────────────────►│ СБОЙ ВВОДА        │ сбой +1,
 *   │ ВВЕСТИ ОТВЕТ│                        └───────────────────┘ к началу
 *   └──────┬──────┘
 *          │ «Отправить» нажато
 *          ▼
 *   ┌─────────────┐  ждём 2.5 с и читаем страницу
 *   │ ПОПЫТКА N   │  ответов +1 - только здесь
 *   └──────┬──────┘
 *          ├── капчи на странице нет ────────────────────────────► true (solved)
 *          └── капча снова ─► к началу, новая картинка
 *
 * Обновление картинки попытку не тратит: это только клик «Другой текст»,
 * ничего hh не отправляется. Попытка - введённый и отправленный ответ.
 */
export const makeCaptchaSolve = (
  load: () => CaptchaSolverConfig | null = loadCaptchaSolver,
  recognize: CaptchaRecognize = recognizeWithHarness,
  pause: (seconds: number) => Effect.Effect<void> = (seconds) => Effect.sleep(`${seconds * 1000} millis`)
): CaptchaSolve => {
  /** Сколько ответов уже введено на этой странице. */
  const attempts = new WeakMap<Page, number>()


  const firstVisible = async (page: Page, selectors: ReadonlyArray<string>): Promise<Locator | null> => {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if (await locator.isVisible().catch(() => false)) return locator
    }
    return null
  }

  /**
   * Новая картинка у hh: о ту же капчу второй раз не бьёмся. После нажатия
   * ждём именно смены `src` (hh меняет ключ капчи), а не просто спим: иначе
   * снимок может прийтись на ещё не подменённый кадр.
   */
  const refreshPicture = (page: Page) =>
    Effect.gen(function*() {
      const picture = page.locator(CAPTCHA_PICTURE_SELECTOR).first()
      const read = () =>
        Effect.tryPromise(() => picture.getAttribute("src", { timeout: 2_000 })).pipe(
          Effect.orElseSucceed(() => null as string | null)
        )
      const before = yield* read()
      const refreshed = yield* Effect.tryPromise(async () => {
        const button = await firstVisible(page, CAPTCHA_REFRESH_SELECTORS)
        if (button === null) return false
        await button.click({ timeout: 5_000 })
        return true
      }).pipe(Effect.orElseSucceed(() => false))
      if (!refreshed) {
        yield* Effect.logWarning("captcha: renew button not found, retrying on the same picture")
        return false
      }
      for (let waited = 0; waited < 2_000; waited += 250) {
        const now = yield* read()
        if (now !== null && now !== before) return true
        yield* Effect.sleep("250 millis")
      }
      yield* Effect.logWarning("captcha: the picture did not change after renew, reading the same one")
      return false
    })

  /** Картинка капчи; `null`, если она так и не отрисовалась. */
  const capturePicture = (page: Page) =>
    Effect.gen(function*() {
      const picture = page.locator(CAPTCHA_PICTURE_SELECTOR).first()
      // Картинка дорисовывается после появления окна: скриншот раньше времени
      // даёт белый прямоугольник. Пробуем несколько раз, пустой не отправляем.
      // Пока картинка не загрузилась, браузер рисует значок «битой картинки» с
      // подписью `captcha`: он не белый, проходит проверку на пустоту и съедает
      // попытку модели. Ждём до ~4 с, пока `<img>` реально загрузится.
      for (let waited = 0; waited < 4_000; waited += 250) {
        const loaded = yield* Effect.tryPromise(() =>
          picture.evaluate((node) => {
            // В пакете нет DOM-типов: читаем поля `<img>` как у обычного объекта.
            type Img = { readonly complete?: boolean; readonly naturalWidth?: number }
            const element = node as unknown as { readonly tagName: string; querySelector(selector: string): unknown }
            const img = (element.tagName === "IMG" ? element : element.querySelector("img")) as Img | null
            return img === null ? true : img.complete === true && (img.naturalWidth ?? 0) > 0
          }, undefined, { timeout: 2_000 })
        ).pipe(Effect.orElseSucceed(() => true))
        if (loaded) break
        yield* Effect.sleep("250 millis")
      }
      for (let tryNo = 0; tryNo < BLANK_RETRIES; tryNo++) {
        const shot = yield* Effect.tryPromise(() => picture.screenshot({ type: "png", timeout: 5_000 })).pipe(
          Effect.orElseSucceed(() => null)
        )
        if (shot !== null && !isBlankPicture(shot)) return shot
        if (tryNo < BLANK_RETRIES - 1) yield* Effect.sleep(`${BLANK_RETRY_MS} millis`)
      }
      return null
    })

  /**
   * Ввод ответа. Сначала ждём поле: страница рисует окно капчи не мгновенно.
   * `false` - ответ введён не был (поле так и не появилось).
   */
  const typeAnswer = (page: Page, text: string) =>
    Effect.gen(function*() {
      let input: Locator | null = null
      for (let waited = 0; waited < CAPTCHA_FIELD_WAIT_MS; waited += 250) {
        input = yield* Effect.tryPromise(() => firstVisible(page, CAPTCHA_INPUT_SELECTORS)).pipe(
          Effect.orElseSucceed(() => null as Locator | null)
        )
        if (input !== null) break
        yield* Effect.sleep("250 millis")
      }
      if (input === null) return false
      const field = input
      return yield* Effect.tryPromise(async () => {
        await field.fill(text, { timeout: 5_000 })
        const submit = await firstVisible(page, CAPTCHA_SUBMIT_SELECTORS)
        if (submit === null) await field.press("Enter")
        else await submit.click({ timeout: 5_000 })
        return true
      }).pipe(Effect.orElseSucceed(() => false))
    })

  return (page) =>
    Effect.gen(function*() {
      const config = load()
      if (config === null) return false
      const answeredBefore = attempts.get(page) ?? 0
      if (answeredBefore >= config.maxAttempts) return false

      const recorder = yield* Effect.serviceOption(CaptchaRecorder)
      const note = (
        attempt: number,
        outcome: CaptchaAttemptReport["outcome"],
        answer: string | null,
        durationMs: number,
        error: string | null,
        filter: CaptchaFilter
      ) => {
        if (Option.isSome(recorder)) {
          recorder.value.attempts.push({
            harness: config.harnessId,
            model: config.model,
            filter,
            attempt,
            answer,
            outcome,
            durationMs,
            error
          })
        }
      }

      let answered = answeredBefore
      let stalls = 0

      while (answered < config.maxAttempts && stalls < CAPTCHA_STALL_LIMIT) {
        // Повтор: и после неверного ответа, и после сбоя - картинка новая.
        if (answered > answeredBefore || stalls > 0) yield* refreshPicture(page)

        const image = yield* capturePicture(page)
        if (image === null) {
          stalls += 1
          const error = "картинка капчи не отрисовалась"
          failures.set(page, error)
          // Ничего не отправили модели - фильтр не применялся.
          note(answered + 1, "error", null, 0, error, "none")
          yield* Effect.logWarning(
            `captcha: picture is still blank or missing, the model was not asked (stall ${stalls}/${CAPTCHA_STALL_LIMIT})`
          )
          continue
        }

        const prepared = yield* Effect.promise(() => prepareCaptchaImage(image, config.filter))
        const result = yield* recognize(config, prepared.image)

        // Харнес недоступен: повторять нечего, но это не капча hh - задача
        // завершится как `transport`, и её поставят в очередь заново.
        if (result.unavailable) {
          const error = result.error ?? "харнес не ответил"
          failures.set(page, error)
          note(answered + 1, "error", null, result.durationMs, error, prepared.filter)
          yield* Effect.logWarning(
            `captcha: solver ${config.harnessId}/${config.model} is unavailable: ${error}`
          )
          return yield* Effect.fail(
            new Error(`капча: решатель ${config.harnessId}/${config.model} недоступен - ${error}`)
          )
        }

        if (!result.ok || result.text === null) {
          stalls += 1
          const error = result.error ?? "модель не вернула текст"
          failures.set(page, error)
          note(answered + 1, "error", null, result.durationMs, error, prepared.filter)
          yield* Effect.logWarning(
            `captcha: ${config.harnessId}/${config.model} read nothing (${error}); attempt ${answered + 1}/${config.maxAttempts} is not spent, retrying with a new picture (stall ${stalls}/${CAPTCHA_STALL_LIMIT})`
          )
          continue
        }

        const text = result.text
        // Человек не отвечает мгновенно: добираем паузу до 10-15 секунд.
        const target = CAPTCHA_SOLVE_MIN_DELAY_SECONDS +
          Math.random() * (CAPTCHA_SOLVE_MAX_DELAY_SECONDS - CAPTCHA_SOLVE_MIN_DELAY_SECONDS)
        const remaining = target - result.durationMs / 1000
        if (remaining > 0) yield* pause(remaining)

        if (!(yield* typeAnswer(page, text))) {
          stalls += 1
          const error = "поле ответа не найдено на странице"
          failures.set(page, error)
          note(answered + 1, "error", text, result.durationMs, error, prepared.filter)
          yield* Effect.logWarning(
            `captcha: ${error}; answer "${text}" was not entered, attempt ${answered + 1}/${config.maxAttempts} is not spent (stall ${stalls}/${CAPTCHA_STALL_LIMIT})`
          )
          continue
        }

        // Ответ введён - вот это и есть попытка. Фиксируем сразу: даже если
        // дальше что-то упадёт, попытка уже израсходована.
        answered += 1
        attempts.set(page, answered)
        failures.delete(page)
        yield* Effect.logInfo(
          `captcha: answered "${text}" with ${config.harnessId}/${config.model} filter=${prepared.filter} in ${result.durationMs} ms (attempt ${answered}/${config.maxAttempts})`
        )
        yield* Effect.sleep(`${AFTER_SUBMIT_MS} millis`)
        // Приняла ли hh ответ: капча на странице осталась - значит, нет.
        const html = yield* Effect.tryPromise(() => page.content()).pipe(
          Effect.orElseSucceed(() => null as string | null)
        )
        const rejected = html !== null && classifyResponsePage(html, page.url()) === "captcha"
        note(answered, rejected ? "rejected" : "solved", text, result.durationMs, null, prepared.filter)
        if (!rejected) return true
        failures.set(page, `hh не принял ответ «${text}»`)
        yield* Effect.logWarning(
          `captcha: hh showed the captcha again after "${text}" (attempt ${answered}/${config.maxAttempts})`
        )
      }

      if (answered >= config.maxAttempts) {
        yield* Effect.logWarning(`captcha: ${answered} answers entered, hh still asks for a captcha`)
      } else {
        yield* Effect.logWarning(
          `captcha: gave up after ${stalls} stalls without an answer, last reason: ${failures.get(page) ?? "unknown"}`
        )
      }
      return answered > answeredBefore
    })
}
