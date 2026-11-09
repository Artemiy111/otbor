import type { ApiError, LocalModelHealth, LocalModelInput, LocalModelServer } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  probeLocalModel,
  readOpenAiStore,
  removeOpenAiEndpoint,
  upsertOpenAiEndpoint,
  type OpenAiEndpointDef
} from "@otbor/local-models"
import { Context, Effect, Layer } from "effect"

export interface LocalModelServiceShape {
  /** Сохранённые серверы без ключей. */
  readonly list: () => Effect.Effect<ReadonlyArray<LocalModelServer>, ApiError>
  readonly upsert: (
    input: LocalModelInput
  ) => Effect.Effect<ReadonlyArray<LocalModelServer>, ApiError>
  /** Живость каждого сохранённого сервера (параллельно, таймаут 5 с на сервер). */
  readonly check: () => Effect.Effect<ReadonlyArray<LocalModelHealth>, ApiError>
  readonly remove: (id: string) => Effect.Effect<ReadonlyArray<LocalModelServer>, ApiError>
}

/** Эти id заняты ACP-агентами каталога: задача с ними пошла бы мимо сервера. */
const RESERVED_IDS: ReadonlyArray<string> = ["opencode", "claude"]
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i

const invalid = (message: string) => new InvalidInput({ message: `local model: ${message}` })

const fromFile = (cause: unknown) =>
  invalid(cause instanceof Error ? cause.message : String(cause))

export const toServer = (def: OpenAiEndpointDef): LocalModelServer => ({
  id: def.id,
  name: def.name ?? def.id,
  url: def.url,
  hasKey: def.apiKey !== undefined && def.apiKey.trim() !== ""
})

/**
 * Проверка ввода и слияние с тем, что уже сохранено: пустой ключ не стирает
 * старый (его UI не видит), стирает только явный `clearKey`.
 */
export const mergeServer = (
  input: LocalModelInput,
  existing: OpenAiEndpointDef | undefined
): OpenAiEndpointDef => {
  const id = input.id.trim()
  if (!ID_PATTERN.test(id)) {
    throw invalid("id: латиница, цифры, «-» и «_», до 32 символов")
  }
  if (RESERVED_IDS.includes(id.toLowerCase())) throw invalid(`id «${id}» занят агентом каталога`)
  const url = input.url.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme")
  } catch {
    throw invalid("адрес должен быть http(s)://…, например http://127.0.0.1:8000/v1")
  }
  const typedKey = input.apiKey?.trim()
  const apiKey = input.clearKey === true
    ? undefined
    : typedKey !== undefined && typedKey !== ""
    ? typedKey
    : existing?.apiKey
  const name = input.name?.trim()
  return {
    id,
    url,
    ...(name !== undefined && name !== "" ? { name } : {}),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(existing?.variant === undefined ? {} : { variant: existing.variant }),
    ...(existing?.timeoutSeconds === undefined ? {} : { timeoutSeconds: existing.timeoutSeconds })
  }
}

/**
 * Локальные модели живут в `~/.otbor/openai.json` на машине, где работает этот
 * API (как прокси в `~/.otbor/proxy`): файл читает и харнес. В Postgres их нет.
 */
export class LocalModelService extends Context.Service<LocalModelService, LocalModelServiceShape>()(
  "otbor/cloud/LocalModelService"
) {
  static readonly layer = Layer.succeed(
    LocalModelService,
    (() => {
      const list: LocalModelServiceShape["list"] = () =>
        Effect.try({ try: () => readOpenAiStore().map(toServer), catch: fromFile })

      const upsert: LocalModelServiceShape["upsert"] = (input) =>
        Effect.try({
          try: () => {
            const id = input.id.trim()
            const existing = readOpenAiStore().find((item) => item.id === id)
            upsertOpenAiEndpoint(mergeServer(input, existing))
          },
          catch: (cause) => (cause instanceof InvalidInput ? cause : fromFile(cause))
        }).pipe(Effect.andThen(list()))

      const remove: LocalModelServiceShape["remove"] = (id) =>
        Effect.try({ try: () => removeOpenAiEndpoint(id), catch: fromFile }).pipe(
          Effect.andThen(list())
        )

      const check: LocalModelServiceShape["check"] = () =>
        Effect.try({ try: () => readOpenAiStore(), catch: fromFile }).pipe(
          Effect.flatMap((defs) =>
            Effect.forEach(
              defs,
              (def) =>
                Effect.promise(() => probeLocalModel(def)).pipe(
                  Effect.map((probe): LocalModelHealth => ({
                    id: def.id,
                    alive: probe.alive,
                    ok: probe.ok,
                    latencyMs: probe.latencyMs,
                    models: probe.models,
                    error: probe.error,
                    checkedAt: new Date().toISOString()
                  }))
                ),
              { concurrency: "unbounded" }
            )
          )
        )

      return LocalModelService.of({ list, upsert, remove, check })
    })()
  )
}
