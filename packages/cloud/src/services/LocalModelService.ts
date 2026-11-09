import type {
  ApiError,
  CaptchaSolverSettings,
  CaptchaSolverTestResult,
  LocalModelHealth,
  LocalModelInput,
  LocalModelServer
} from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  probeLocalModel,
  readCaptchaSettings,
  recognizeCaptcha,
  writeCaptchaSettings,
  readOpenAiStore,
  removeOpenAiEndpoint,
  upsertOpenAiEndpoint,
  type OpenAiEndpointDef
} from "@otbor/local-models"
import { readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
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
  /** Каким харнесом и моделью читать капчу hh (`~/.otbor/captcha.json`). */
  readonly captchaGet: () => Effect.Effect<CaptchaSolverSettings, ApiError>
  readonly captchaSet: (
    input: CaptchaSolverSettings
  ) => Effect.Effect<CaptchaSolverSettings, ApiError>
  /** Прогон по самой свежей сохранённой картинке капчи, без браузера. */
  readonly captchaTest: (
    input: CaptchaSolverSettings
  ) => Effect.Effect<CaptchaSolverTestResult, ApiError>
}

/** Где браузер харнеса складывает картинки капчи (та же папка, что у харнеса). */
const captchaShotsDir = (): string => {
  const override = process.env.OTBOR_CAPTCHA_SHOTS_DIR?.trim()
  return override !== undefined && override !== "" && override !== "off"
    ? override
    : join(homedir(), ".otbor", "captcha-shots")
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
                    modelIds: probe.modelIds,
                    error: probe.error,
                    checkedAt: new Date().toISOString()
                  }))
                ),
              { concurrency: "unbounded" }
            )
          )
        )

      const captchaGet: LocalModelServiceShape["captchaGet"] = () =>
        Effect.try({ try: () => readCaptchaSettings(), catch: fromFile })

      const captchaSet: LocalModelServiceShape["captchaSet"] = (input) =>
        Effect.try({
          try: () => {
            const next = {
              enabled: input.enabled,
              harnessId: input.harnessId.trim(),
              model: input.model.trim(),
              maxAttempts: input.maxAttempts,
              timeoutSeconds: input.timeoutSeconds
            }
            if (next.maxAttempts < 1 || next.maxAttempts > 10) throw invalid("попыток от 1 до 10")
            if (next.timeoutSeconds < 5 || next.timeoutSeconds > 300) throw invalid("таймаут от 5 до 300 секунд")
            if (next.enabled && (next.harnessId === "" || next.model === "")) {
              throw invalid("выберите харнес и модель для капчи")
            }
            writeCaptchaSettings(next)
            return next
          },
          catch: (cause) => (cause instanceof InvalidInput ? cause : fromFile(cause))
        })

      const captchaTest: LocalModelServiceShape["captchaTest"] = (settings) =>
        Effect.gen(function*() {
          const failure = (error: string, picture: string | null = null): CaptchaSolverTestResult => ({
            ok: false,
            text: null,
            durationMs: 0,
            picture,
            error
          })
          if (settings.harnessId === "" || settings.model === "") return failure("харнес и модель не выбраны")
          const endpoint = readOpenAiStore().find((item) => item.id === settings.harnessId)
          if (endpoint === undefined) {
            return failure(
              `«${settings.harnessId}» не локальный сервер: агенты (opencode, claude) запускает харнес, поэтому проверка пройдёт на настоящей капче`
            )
          }
          const dir = captchaShotsDir()
          const latest = readdirSync(dir).filter((name) => name.endsWith("-picture.png")).sort().at(-1)
          if (latest === undefined) return failure("сохранённых картинок капчи ещё нет")
          const result = yield* Effect.promise(() =>
            recognizeCaptcha(
              { endpoint, model: settings.model, timeoutSeconds: settings.timeoutSeconds },
              readFileSync(join(dir, latest))
            )
          )
          return {
            ok: result.ok,
            text: result.text,
            durationMs: result.durationMs,
            picture: latest,
            error: result.error
          }
        }).pipe(
          Effect.catchDefect((cause) => Effect.succeed<CaptchaSolverTestResult>({
            ok: false,
            text: null,
            durationMs: 0,
            picture: null,
            error: cause instanceof Error ? cause.message : String(cause)
          }))
        )

      return LocalModelService.of({ list, upsert, remove, check, captchaGet, captchaSet, captchaTest })
    })()
  )
}
