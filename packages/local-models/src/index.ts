import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Schema } from "effect"

/**
 * Локальные модели, сохранённые оператором: `~/.otbor/openai.json` (0600),
 * рядом с `harness.json`. Это локальный секрет устройства, а не данные
 * продукта: ключ API не попадает ни в Postgres, ни в репозиторий, ни в логи.
 */
export const openAiStorePath = (
  env: Readonly<Record<string, string | undefined>> = process.env
): string => join(env.OTBOR_HARNESS_DIR?.trim() || join(homedir(), ".otbor"), "openai.json")

export const EndpointDef = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  url: Schema.String,
  apiKey: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Int)
})

export type OpenAiEndpointDef = typeof EndpointDef.Type

const StoreFile = Schema.Struct({ endpoints: Schema.Array(EndpointDef) })

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error &&
  (error as { code?: unknown }).code === "ENOENT"

/** Нет файла — нет эндпоинтов; битый файл — ошибка с путём. */
export const readOpenAiStore = (path = openAiStorePath()): ReadonlyArray<OpenAiEndpointDef> => {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return []
    throw new Error(`Unable to read ${path}: ${(error as Error).message}`)
  }
  try {
    return Schema.decodeUnknownSync(StoreFile)(JSON.parse(raw)).endpoints
  } catch (cause) {
    throw new Error(
      `${path}: invalid content (${cause instanceof Error ? cause.message.slice(0, 200) : String(cause)}). ` +
        "Fix it or re-run `otbor harness model add`."
    )
  }
}

export const writeOpenAiStore = (
  endpoints: ReadonlyArray<OpenAiEndpointDef>,
  path = openAiStorePath()
): string => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify({ endpoints }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

/** Добавить или заменить эндпоинт с тем же id. */
export const upsertOpenAiEndpoint = (def: OpenAiEndpointDef, path = openAiStorePath()): string =>
  writeOpenAiStore([...readOpenAiStore(path).filter((item) => item.id !== def.id), def], path)

/** Удалить эндпоинт; false, если такого id не было. */
export const removeOpenAiEndpoint = (id: string, path = openAiStorePath()): boolean => {
  const current = readOpenAiStore(path)
  const next = current.filter((item) => item.id !== id)
  if (next.length === current.length) return false
  writeOpenAiStore(next, path)
  return true
}

/** Результат проверки живости сервера моделей. */
export interface LocalModelProbe {
  /** Сервер ответил по HTTP (`/health` или `/models`), даже если отказал в доступе. */
  readonly alive: boolean
  /** Сервер жив и отдаёт список моделей — на него можно слать задачи. */
  readonly ok: boolean
  /** Время ответа; null, если ответа не было. */
  readonly latencyMs: number | null
  /** Сколько моделей сервер перечислил. */
  readonly models: number
  /** Идентификаторы моделей сервера: из них оператор выбирает модель для капчи. */
  readonly modelIds: ReadonlyArray<string>
  readonly error: string | null
}

/** `http://host:1111/v1` -> `http://host:1111` (oMLX и vLLM держат `/health` в корне). */
const originOf = (url: string): string =>
  url.trim().replace(/\/+$/, "").replace(/\/v1$/, "")

/**
 * Проверка живости. Сначала `GET {корень}/health` (его не защищает ключ API),
 * затем `GET {url}/models` с ключом. Первый отвечает «жив ли процесс», второй —
 * «можно ли слать задачи»: сервер с неверным ключом жив, но не пригоден, и это
 * разные состояния. Модель не вызывается. Не бросает; ключ из ошибок вырезается.
 */
export const probeLocalModel = async (
  def: OpenAiEndpointDef,
  timeoutMs = 5000
): Promise<LocalModelProbe> => {
  const started = Date.now()
  const key = def.apiKey?.trim() ?? ""
  const scrub = (text: string) => (key === "" ? text : text.split(key).join("***"))
  const get = (url: string, withKey: boolean) =>
    fetch(url, {
      headers: {
        accept: "application/json",
        ...(withKey && key !== "" ? { authorization: `Bearer ${key}` } : {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    })

  const health = await get(`${originOf(def.url)}/health`, false).catch(() => null)
  try {
    const response = await get(`${def.url.trim().replace(/\/+$/, "")}/models`, true)
    const latencyMs = Date.now() - started
    const alive = (health?.ok ?? false) || response.status < 500
    if (response.status === 401 || response.status === 403) {
      return {
        alive,
        ok: false,
        latencyMs,
        models: 0,
        modelIds: [],
        error: key === ""
          ? "сервер жив, но требует ключ API"
          : "сервер жив, но отклонил ключ API"
      }
    }
    if (!response.ok) {
      return { alive, ok: false, latencyMs, models: 0, modelIds: [], error: `HTTP ${response.status}` }
    }
    const body = (await response.json()) as { readonly data?: unknown }
    const modelIds = Array.isArray(body.data)
      ? body.data.flatMap((item) =>
        typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
          ? [(item as { id: string }).id]
          : []
      )
      : []
    const models = Array.isArray(body.data) ? body.data.length : 0
    return models > 0
      ? { alive: true, ok: true, latencyMs, models, modelIds, error: null }
      : { alive: true, ok: false, latencyMs, models: 0, modelIds: [], error: "сервер не перечислил ни одной модели" }
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError"
    return {
      // `/models` не ответил, но `/health` мог: процесс жив, просто завис.
      alive: health?.ok ?? false,
      ok: false,
      latencyMs: health?.ok ? Date.now() - started : null,
      models: 0,
      modelIds: [],
      error: scrub(
        timedOut
          ? `нет ответа за ${timeoutMs / 1000} с`
          : `не отвечает: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }
}

export * from "./captcha-image.ts"
export * from "./captcha.ts"
