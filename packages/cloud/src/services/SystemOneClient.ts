import { ANALYSIS_QUESTIONS, RawAnswers, type AnalysisState } from "@otbor/domain"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

export type SystemOneErrorKind = "unreachable" | "unauthorized" | "bad_response"

/**
 * `unreachable`: nothing answered (connection refused, timeout, 5xx).
 * `unauthorized`: the server rejected the bearer key (401/403).
 * `bad_response`: it answered, but not with a usable `answers` object.
 * The message never contains the API key.
 */
export class SystemOneError extends Schema.TaggedError<SystemOneError>()("SystemOneError", {
  kind: Schema.Literals(["unreachable", "unauthorized", "bad_response"]),
  message: Schema.String
}) {}

/** The pass cannot continue when the server itself is the problem. */
export const isServerDown = (error: SystemOneError): boolean => error.kind !== "bad_response"

export interface SystemOneConfig {
  readonly url: string
  readonly apiKey: Redacted.Redacted<string> | undefined
  readonly model: string
  readonly timeoutMs: number
}

export interface SystemOneAnalysis {
  readonly answers: RawAnswers
  readonly latencyMs: number
  /** Token count when the server reports one. */
  readonly tokens: number | null
}

export interface SystemOneClientShape {
  readonly model: string
  readonly analyze: (state: AnalysisState) => Effect.Effect<SystemOneAnalysis, SystemOneError>
}

export const systemOneConfig = Effect.gen(function*() {
  const url = yield* Config.String("OTBOR_SYSTEMONE_URL").pipe(
    Config.withDefault("http://127.0.0.1:1111")
  )
  const apiKey = yield* Config.Redacted("OTBOR_SYSTEMONE_API_KEY").pipe(Config.option)
  const model = yield* Config.String("OTBOR_SYSTEMONE_MODEL").pipe(
    Config.withDefault("clef-flash-4bit")
  )
  const timeoutMs = yield* Config.Number("OTBOR_SYSTEMONE_TIMEOUT_MS").pipe(
    Config.withDefault(60_000)
  )
  return {
    url,
    apiKey: Option.getOrUndefined(apiKey),
    model,
    timeoutMs
  } satisfies SystemOneConfig
})

const decodeAnswers = Schema.decodeUnknownEffect(RawAnswers)

const numberAt = (value: unknown, ...path: ReadonlyArray<string>): number | null => {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== "object") return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null
}

const make = (config: SystemOneConfig) =>
  Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient
    const endpoint = `${config.url.replace(/\/+$/, "")}/v1/systemone`

    const redact = (text: string): string => {
      if (config.apiKey === undefined) return text
      const secret = Redacted.value(config.apiKey)
      return secret === "" ? text : text.split(secret).join("***")
    }

    const unreachable = (detail: string) =>
      new SystemOneError({
        kind: "unreachable",
        message: redact(`SystemOne недоступен (${endpoint}): ${detail}`)
      })

    const analyze: SystemOneClientShape["analyze"] = Effect.fn("SystemOneClient.analyze")(
      function*(state) {
        const started = Date.now()
        let request = HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({
            model: config.model,
            state,
            questions: ANALYSIS_QUESTIONS
          })
        )
        if (config.apiKey !== undefined) request = HttpClientRequest.bearerToken(request, config.apiKey)

        const response = yield* http.execute(request).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(config.timeoutMs),
            orElse: () => Effect.fail(unreachable(`таймаут ${config.timeoutMs} мс`))
          }),
          Effect.mapError((error) =>
            error instanceof SystemOneError ? error : unreachable(error.message)
          )
        )

        if (response.status === 401 || response.status === 403) {
          return yield* new SystemOneError({
            kind: "unauthorized",
            message: `SystemOne отклонил ключ (HTTP ${response.status}); проверьте OTBOR_SYSTEMONE_API_KEY`
          })
        }
        if (response.status >= 500) {
          return yield* unreachable(`HTTP ${response.status}`)
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* new SystemOneError({
            kind: "bad_response",
            message: `SystemOne ответил HTTP ${response.status}`
          })
        }

        const body = yield* response.json.pipe(
          Effect.mapError(
            () => new SystemOneError({ kind: "bad_response", message: "SystemOne вернул не JSON" })
          )
        )
        const answers = yield* decodeAnswers(
          (body as { readonly answers?: unknown } | null)?.answers
        ).pipe(
          Effect.mapError(
            (error) =>
              new SystemOneError({
                kind: "bad_response",
                message: redact(`SystemOne: неожиданный формат answers: ${error.message}`.slice(0, 500))
              })
          )
        )

        return {
          answers,
          latencyMs: Date.now() - started,
          tokens:
            numberAt(body, "usage", "total_tokens") ??
            numberAt(body, "tokens") ??
            numberAt(body, "usage", "prompt_tokens")
        }
      }
    )

    return SystemOneClient.of({ model: config.model, analyze })
  })

/** Local model server on the operator's Mac (omlx). Not a chat model. */
export class SystemOneClient extends Context.Service<SystemOneClient, SystemOneClientShape>()(
  "otbor/cloud/SystemOneClient"
) {
  /** Explicit configuration, mostly for tests. */
  static readonly layerWith = (config: SystemOneConfig) =>
    Layer.effect(SystemOneClient, make(config)).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = Layer.unwrap(systemOneConfig.pipe(Effect.map(SystemOneClient.layerWith)))
}
