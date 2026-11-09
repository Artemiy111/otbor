import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Schema } from "effect"
import { readOpenAiStore, type OpenAiEndpointDef } from "./index.ts"

/**
 * Настройки распознавания капчи: `~/.otbor/captcha.json` (0600). Файл лежит на
 * машине харнеса, как `openai.json`: капчу видит именно браузер этой машины,
 * и картинка уходит только на локальный сервер моделей, а не в облако.
 */
export const captchaStorePath = (
  env: Readonly<Record<string, string | undefined>> = process.env
): string => join(env.OTBOR_HARNESS_DIR?.trim() || join(homedir(), ".otbor"), "captcha.json")

export const DEFAULT_CAPTCHA_ATTEMPTS = 5
export const DEFAULT_CAPTCHA_TIMEOUT_SECONDS = 60

export const CaptchaSettingsFile = Schema.Struct({
  /** Выключено: капча, как раньше, останавливает отправки аккаунта. */
  enabled: Schema.Boolean,
  /** id любого харнеса каталога: `opencode`, `claude` или локальный сервер из `openai.json`. */
  harnessId: Schema.String,
  /** Имя модели на этом сервере, например `gemma-4-E4B-it-oQ4e-mtp`. */
  model: Schema.String,
  /** Сколько раз подряд пробовать ввести ответ, прежде чем сдаться. */
  maxAttempts: Schema.Int,
  timeoutSeconds: Schema.Int
})
export type CaptchaSettingsFile = typeof CaptchaSettingsFile.Type

/** Файл может хранить не все поля: недостающие берутся из значений по умолчанию. */
const CaptchaSettingsPartial = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  harnessId: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  maxAttempts: Schema.optional(Schema.Int),
  timeoutSeconds: Schema.optional(Schema.Int)
})

export const DEFAULT_CAPTCHA_SETTINGS: CaptchaSettingsFile = {
  enabled: false,
  harnessId: "",
  model: "",
  maxAttempts: DEFAULT_CAPTCHA_ATTEMPTS,
  timeoutSeconds: DEFAULT_CAPTCHA_TIMEOUT_SECONDS
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error &&
  (error as { code?: unknown }).code === "ENOENT"

/** Нет файла — распознавание выключено; битый файл — ошибка с путём. */
export const readCaptchaSettings = (path = captchaStorePath()): CaptchaSettingsFile => {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return DEFAULT_CAPTCHA_SETTINGS
    throw new Error(`Unable to read ${path}: ${(error as Error).message}`)
  }
  try {
    return { ...DEFAULT_CAPTCHA_SETTINGS, ...Schema.decodeUnknownSync(CaptchaSettingsPartial)(JSON.parse(raw)) }
  } catch (cause) {
    throw new Error(
      `${path}: invalid content (${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}).`
    )
  }
}

export const writeCaptchaSettings = (
  settings: CaptchaSettingsFile,
  path = captchaStorePath()
): string => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

/** Готовый к работе решатель: харнес и модель заданы. */
export interface CaptchaSolverConfig {
  readonly harnessId: string
  /** Сервер из `openai.json`, если харнес - локальная модель; иначе агент ACP. */
  readonly endpoint: OpenAiEndpointDef | null
  readonly model: string
  readonly maxAttempts: number
  readonly timeoutSeconds: number
}

/**
 * Что нужно браузеру прямо сейчас; `null`, если распознавание выключено или
 * не настроено. Читается при каждой капче, поэтому правка в настройках
 * действует без перезапуска харнеса. Не бросает: сломанный файл — это `null`.
 */
export const loadCaptchaSolver = (
  env: Readonly<Record<string, string | undefined>> = process.env
): CaptchaSolverConfig | null => {
  try {
    const settings = readCaptchaSettings(captchaStorePath(env))
    if (!settings.enabled || settings.model.trim() === "" || settings.harnessId.trim() === "") return null
    const harnessId = settings.harnessId.trim()
    const endpoint = readOpenAiStore().find((item) => item.id === harnessId) ?? null
    return {
      harnessId,
      endpoint,
      model: settings.model.trim(),
      maxAttempts: Math.max(1, settings.maxAttempts),
      timeoutSeconds: Math.max(1, settings.timeoutSeconds)
    }
  } catch {
    return null
  }
}

export const CAPTCHA_PROMPT =
  "You read CAPTCHA images. The picture contains a word or words, possibly curved or noisy. " +
  "Return ONLY the text from the image, exactly as it is written, in its own language, " +
  "keeping spaces between words. No quotes, no explanations, no trailing punctuation."

/**
 * Пауза между появлением капчи и отправкой ответа (как в hh-applicant-tool:
 * мгновенный ответ выглядит как бот). Секунды, случайно в этом диапазоне.
 */
export const CAPTCHA_SOLVE_MIN_DELAY_SECONDS = 10
export const CAPTCHA_SOLVE_MAX_DELAY_SECONDS = 15

/** Ответ модели -> то, что вводят в поле: без размышлений, кавычек, переносов строк. */
export const cleanCaptchaAnswer = (raw: string): string => {
  const line = raw
    .replace(/^\s*<think>[\s\S]*?<\/think>/, "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  return (line ?? "")
    .replace(/^["'«»“”`\s]+|["'«»“”`.,!\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export interface CaptchaRecognition {
  readonly ok: boolean
  readonly text: string | null
  readonly durationMs: number
  readonly error: string | null
}

/**
 * Распознаёт картинку локальной моделью (`POST /chat/completions` с
 * `image_url` в виде data URI). Картинка передаётся потоком байтов, на диск
 * ничего не пишется. Не бросает; ключ API из ошибок вырезается.
 */
export const recognizeCaptcha = async (
  config: { readonly endpoint: OpenAiEndpointDef; readonly model: string; readonly timeoutSeconds: number },
  image: Uint8Array,
  mime = "image/png"
): Promise<CaptchaRecognition> => {
  const started = Date.now()
  const key = config.endpoint.apiKey?.trim() ?? ""
  const scrub = (text: string) => (key === "" ? text : text.split(key).join("***"))
  try {
    const response = await fetch(`${config.endpoint.url.trim().replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(key === "" ? {} : { authorization: `Bearer ${key}` })
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0,
        max_tokens: 64,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: CAPTCHA_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${Buffer.from(image).toString("base64")}` }
            }
          ]
        }]
      }),
      signal: AbortSignal.timeout(config.timeoutSeconds * 1000)
    })
    const body = (await response.json().catch(() => null)) as {
      readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: unknown } }>
      readonly error?: { readonly message?: unknown }
    } | null
    const durationMs = Date.now() - started
    if (!response.ok) {
      const message = body?.error?.message
      return {
        ok: false,
        text: null,
        durationMs,
        error: scrub(`HTTP ${response.status}${typeof message === "string" ? `: ${message.slice(0, 300)}` : ""}`)
      }
    }
    const content = body?.choices?.[0]?.message?.content
    const text = typeof content === "string" ? cleanCaptchaAnswer(content) : ""
    return text === ""
      ? { ok: false, text: null, durationMs, error: "модель не вернула текст" }
      : { ok: true, text, durationMs, error: null }
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError"
    return {
      ok: false,
      text: null,
      durationMs: Date.now() - started,
      error: scrub(
        timedOut
          ? `нет ответа за ${config.timeoutSeconds} с`
          : `запрос не удался: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }
}
