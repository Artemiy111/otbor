import type { AgentHarness, AgentModel, HarnessExit, InferencePayload } from "@otbor/contract"
import { Cause, Duration, Effect, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import {
  EndpointDef,
  openAiStorePath,
  readOpenAiStore,
  type OpenAiEndpointDef
} from "@otbor/local-models"
import {
  decodeInferencePayload,
  InferenceFailed,
  type InferenceArtifacts
} from "./inference.ts"

/**
 * Локальная модель за OpenAI-совместимым API (oMLX, LM Studio, llama.cpp,
 * vLLM, Ollama `/v1`). Это такой же «агент» каталога, как `opencode` или
 * `claude`, но без дочернего процесса: один POST `/chat/completions` на
 * задачу. Никаких инструментов, как и у ACP-инференса.
 */
export interface OpenAiEndpoint {
  /** Идентификатор в каталоге и в `payload.harness`. */
  readonly id: string
  readonly name: string
  /** Корень API вместе с `/v1`, например `http://127.0.0.1:8000/v1`. */
  readonly baseUrl: string
  readonly apiKey?: Redacted.Redacted<string> | undefined
  /** Подпись под моделью в выборе (`local`). */
  readonly variant: string
  readonly timeoutSeconds: number
}

export const DEFAULT_OPENAI_ID = "local"
/** Локальная модель думает долго: запас больше, чем у облачных агентов. */
export const DEFAULT_OPENAI_TIMEOUT_SECONDS = 300
/** Таймаут запроса списка моделей: каталог не должен вешать харнес. */
const PROBE_TIMEOUT = Duration.seconds(10)

export type { OpenAiEndpointDef } from "@otbor/local-models"

export interface OpenAiEnv {
  readonly OTBOR_OPENAI_URL?: string | undefined
  readonly OTBOR_OPENAI_ID?: string | undefined
  readonly OTBOR_OPENAI_NAME?: string | undefined
  readonly OTBOR_OPENAI_API_KEY?: string | undefined
  readonly OTBOR_OPENAI_ENDPOINTS?: string | undefined
  readonly OTBOR_OPENAI_TIMEOUT_SECONDS?: string | undefined
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim()
  return text === undefined || text.length === 0 ? undefined : text
}

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "")

/**
 * Эндпоинты из окружения. `OTBOR_OPENAI_URL` описывает один (id `local`,
 * либо `OTBOR_OPENAI_ID`); `OTBOR_OPENAI_ENDPOINTS` — JSON-массив
 * `{id, url, name?, apiKey?, variant?, timeoutSeconds?}` для нескольких.
 * Запись с тем же id заменяет одиночную. Ключ API живёт только в окружении и
 * в логи не попадает (`Redacted`).
 */
export const resolveOpenAiEndpoints = (
  env: OpenAiEnv,
  saved: ReadonlyArray<OpenAiEndpointDef> = []
): ReadonlyArray<OpenAiEndpoint> => {
  const timeoutRaw = trimmed(env.OTBOR_OPENAI_TIMEOUT_SECONDS)
  const timeout = timeoutRaw === undefined ? DEFAULT_OPENAI_TIMEOUT_SECONDS : Number(timeoutRaw)
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error("OTBOR_OPENAI_TIMEOUT_SECONDS must be a positive integer")
  }

  const byId = new Map<string, OpenAiEndpoint>()
  const make = (def: {
    readonly id: string
    readonly name?: string | undefined
    readonly url: string
    readonly apiKey?: string | undefined
    readonly variant?: string | undefined
    readonly timeoutSeconds?: number | undefined
  }): OpenAiEndpoint => {
    const key = trimmed(def.apiKey)
    return {
      id: def.id.trim(),
      name: trimmed(def.name) ?? def.id.trim(),
      baseUrl: normalizeBaseUrl(def.url),
      apiKey: key === undefined ? undefined : Redacted.make(key),
      variant: trimmed(def.variant) ?? "local",
      timeoutSeconds: def.timeoutSeconds ?? timeout
    }
  }

  // Сохранённые в ~/.otbor/openai.json: основа, окружение их переопределяет.
  for (const def of saved) byId.set(def.id.trim(), make(def))

  const single = trimmed(env.OTBOR_OPENAI_URL)
  if (single !== undefined) {
    const id = trimmed(env.OTBOR_OPENAI_ID) ?? DEFAULT_OPENAI_ID
    byId.set(
      id,
      make({
        id,
        name: trimmed(env.OTBOR_OPENAI_NAME) ?? "Local model (OpenAI API)",
        url: single,
        apiKey: env.OTBOR_OPENAI_API_KEY
      })
    )
  }

  const raw = trimmed(env.OTBOR_OPENAI_ENDPOINTS)
  if (raw !== undefined) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (cause) {
      throw new Error(
        `OTBOR_OPENAI_ENDPOINTS is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
    for (const def of Schema.decodeUnknownSync(Schema.Array(EndpointDef))(json)) {
      byId.set(def.id.trim(), make({ ...def, apiKey: def.apiKey ?? env.OTBOR_OPENAI_API_KEY }))
    }
  }
  return Array.from(byId.values())
}

/**
 * Эндпоинты из `~/.otbor/openai.json` и `process.env`; сломанная конфигурация —
 * сообщение, а не падение.
 */
export const loadOpenAiEndpoints = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Effect.Effect<ReadonlyArray<OpenAiEndpoint>, InferenceFailed> =>
  Effect.try({
    try: () => resolveOpenAiEndpoints(env, readOpenAiStore(openAiStorePath(env))),
    catch: (cause) =>
      new InferenceFailed({
        message: `OpenAI endpoint configuration error: ${cause instanceof Error ? cause.message : String(cause)}`
      })
  })

const ModelsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String }))
})

const ChatResponse = Schema.Struct({
  model: Schema.optional(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.optional(Schema.NullOr(Schema.String)) }),
      finish_reason: Schema.optional(Schema.NullOr(Schema.String))
    })
  ),
  usage: Schema.optional(Schema.Unknown)
})

const redactKey = (endpoint: OpenAiEndpoint, text: string): string => {
  if (endpoint.apiKey === undefined) return text
  const secret = Redacted.value(endpoint.apiKey)
  return secret === "" ? text : text.split(secret).join("***")
}

const errorText = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { readonly message: unknown }).message)
    : String(error)

const request = (endpoint: OpenAiEndpoint, method: "GET" | "POST", path: string) => {
  const url = `${endpoint.baseUrl}${path}`
  const base = method === "GET" ? HttpClientRequest.get(url) : HttpClientRequest.post(url)
  const withAccept = HttpClientRequest.acceptJson(base)
  return endpoint.apiKey === undefined
    ? withAccept
    : HttpClientRequest.bearerToken(withAccept, endpoint.apiKey)
}

/**
 * Список моделей сервера (`GET /models`). Каталог не вызывает модель, поэтому
 * ничего не стоит; недоступный сервер — это `available: false`, а не ошибка.
 */
export const probeOpenAiEndpoint = (
  endpoint: OpenAiEndpoint
): Effect.Effect<AgentHarness, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient
    const response = yield* http.execute(request(endpoint, "GET", "/models")).pipe(
      Effect.timeout(PROBE_TIMEOUT)
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(
          response.status === 401 || response.status === 403
            ? `HTTP ${response.status}: сервер требует (или отклонил) ключ API — задайте его в настройках`
            : `HTTP ${response.status}`
        )
      )
    }
    const body = yield* response.json
    const { data } = yield* Schema.decodeUnknownEffect(ModelsResponse)(body)
    const models: ReadonlyArray<AgentModel> = data.map((model) => ({
      id: model.id,
      label: model.id,
      efforts: [],
      defaultEffort: null,
      variant: endpoint.variant
    }))
    return {
      id: endpoint.id,
      name: endpoint.name,
      available: models.length > 0,
      error: models.length > 0 ? null : "the server lists no models",
      models,
      defaultModel: models[0]?.id ?? null
    } satisfies AgentHarness
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed<AgentHarness>({
        id: endpoint.id,
        name: endpoint.name,
        available: false,
        error: redactKey(
          endpoint,
          `${endpoint.baseUrl} is not reachable: ${errorText(Cause.squash(cause))}`
        ),
        models: [],
        defaultModel: null
      })
    )
  )

/** Размышления локальных моделей (`<think>…</think>`) — не часть ответа. */
export const stripThinking = (text: string): string =>
  text.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim()

/** Системный текст — отдельным сообщением; схема JSON дописывается к запросу. */
export const chatMessages = (
  payload: InferencePayload
): ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }> => {
  const messages: Array<{ readonly role: "system" | "user"; readonly content: string }> = []
  const system = payload.system?.trim()
  if (system !== undefined && system.length > 0) messages.push({ role: "system", content: system })
  const user =
    payload.jsonSchema === undefined
      ? payload.prompt
      : `${payload.prompt}\n\nRespond with JSON only, matching this schema:\n${JSON.stringify(payload.jsonSchema)}`
  messages.push({ role: "user", content: user })
  return messages
}

/**
 * Один запрос `chat/completions` без стриминга. Модель обязательна: у сервера
 * нет «модели по умолчанию», и выбирать за оператора мы не будем.
 */
export const runOpenAiChat = Effect.fn("Harness.runOpenAiChat")(
  function*(
    endpoint: OpenAiEndpoint,
    payload: InferencePayload
  ): Effect.fn.Return<InferenceArtifacts, InferenceFailed, HttpClient.HttpClient> {
    const model = payload.model?.trim()
    if (model === undefined || model.length === 0) {
      return yield* new InferenceFailed({
        message: `endpoint "${endpoint.id}" needs an explicit model in the job payload`
      })
    }
    const http = yield* HttpClient.HttpClient
    const started = Date.now()
    const effort = payload.effort?.trim()

    const failed = (detail: string) =>
      new InferenceFailed({ message: redactKey(endpoint, `${endpoint.name}: ${detail}`) })

    const response = yield* http
      .execute(
        request(endpoint, "POST", "/chat/completions").pipe(
          HttpClientRequest.bodyJsonUnsafe({
            model,
            messages: chatMessages(payload),
            stream: false,
            ...(effort !== undefined && effort.length > 0 ? { reasoning_effort: effort } : {})
          })
        )
      )
      .pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(endpoint.timeoutSeconds),
          orElse: () => Effect.fail(failed(`no answer within ${endpoint.timeoutSeconds} s`))
        }),
        Effect.mapError((error) =>
          error instanceof InferenceFailed ? error : failed(`request failed: ${error.message}`)
        )
      )

    const body = yield* response.json.pipe(
      Effect.mapError(() => failed(`HTTP ${response.status}: the answer is not JSON`))
    )
    if (response.status < 200 || response.status >= 300) {
      const message = (body as { readonly error?: { readonly message?: unknown } } | null)?.error
        ?.message
      return yield* failed(
        `HTTP ${response.status}${typeof message === "string" ? `: ${message.slice(0, 500)}` : ""}`
      )
    }
    const chat = yield* Schema.decodeUnknownEffect(ChatResponse)(body).pipe(
      Effect.mapError((error) => failed(`unexpected answer format: ${error.message.slice(0, 500)}`))
    )
    const text = stripThinking(chat.choices[0]?.message.content ?? "")
    if (text.length === 0) {
      return yield* failed(
        `the model returned no text (finish_reason: ${chat.choices[0]?.finish_reason ?? "unknown"})`
      )
    }
    return {
      text,
      model: chat.model ?? model,
      effort: effort !== undefined && effort.length > 0 ? effort : null,
      usage: chat.usage ?? null,
      providerResponse: body,
      durationMs: Date.now() - started
    }
  }
)

/** Задача для OpenAI-эндпоинта: любой исход — типизированный выход харнеса. */
export const runOpenAiExit = (
  endpoint: OpenAiEndpoint,
  payload: unknown
): Effect.Effect<HarnessExit> =>
  decodeInferencePayload(payload).pipe(
    Effect.flatMap((decoded) => runOpenAiChat(endpoint, decoded)),
    Effect.map((artifacts): HarnessExit => ({ tag: "prepared", artifacts })),
    Effect.catchTag("InferenceFailed", (error) =>
      Effect.succeed<HarnessExit>({ tag: "inference_failed", message: error.message })
    ),
    Effect.provide(FetchHttpClient.layer)
  )
