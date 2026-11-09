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
