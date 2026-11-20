import {
  HhAccountId as HhAccountIdSchema,
  RunnerId as RunnerIdSchema,
  JobKind
} from "@otbor/contract"
import { Effect, Schema } from "effect"

export const DEFAULT_API_URL = "http://127.0.0.1:3001/rpc"
export const DEFAULT_WAIT_SECONDS = 30
/** Задач, которые раннер выполняет одновременно. */
export const DEFAULT_CONCURRENCY = 6
export const MAX_CONCURRENCY = 12

/** Configuration errors are answers, not crashes: print the message and exit. */
export class RunnerConfigError extends Schema.TaggedError<RunnerConfigError>()(
  "RunnerConfigError",
  {
    message: Schema.String
  }
) {}

const RunnerConfig = Schema.Struct({
  apiUrl: Schema.String,
  runnerId: RunnerIdSchema,
  token: Schema.String,
  kinds: Schema.Array(JobKind),
  accounts: Schema.Array(HhAccountIdSchema),
  waitSeconds: Schema.Int,
  concurrency: Schema.Int,
  once: Schema.Boolean
})

export type RunnerConfig = typeof RunnerConfig.Type

const required = (
  env: Readonly<Record<string, string | undefined>>,
  name: string
): Effect.Effect<string, RunnerConfigError> => {
  const value = env[name]?.trim()
  return value === undefined || value.length === 0
    ? Effect.fail(new RunnerConfigError({ message: `${name} is required` }))
    : Effect.succeed(value)
}

/**
 * A comma separated list. An empty or whitespace-only value means "not set", so
 * the fallback applies: omitting `OTBOR_RUNNER_KINDS` defaults to inference,
 * while omitting accounts defaults to the accounts registered for this device.
 */
const commaList = (
  value: string | undefined,
  fallback: ReadonlyArray<string>
): ReadonlyArray<string> => {
  if (value === undefined) return fallback
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length === 0 ? fallback : items
}

const waitSecondsValue = (
  value: string | undefined
): Effect.Effect<number, RunnerConfigError> => {
  if (value === undefined || value.trim() === "") {
    return Effect.succeed(DEFAULT_WAIT_SECONDS)
  }
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= DEFAULT_WAIT_SECONDS
    ? Effect.succeed(parsed)
    : Effect.fail(
        new RunnerConfigError({
          message: `OTBOR_RUNNER_WAIT_SECONDS must be an integer between 0 and ${DEFAULT_WAIT_SECONDS}`
        })
      )
}

const concurrencyValue = (
  value: string | undefined
): Effect.Effect<number, RunnerConfigError> => {
  if (value === undefined || value.trim() === "") return Effect.succeed(DEFAULT_CONCURRENCY)
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONCURRENCY
    ? Effect.succeed(parsed)
    : Effect.fail(
        new RunnerConfigError({
          message: `OTBOR_RUNNER_CONCURRENCY must be an integer between 1 and ${MAX_CONCURRENCY}`
        })
      )
}

/**
 * Pure env parsing so the run loop can be tested without touching process.env.
 * The final object still goes through Schema: the IDs, kinds, accounts and
 * ranges are validated in one place.
 */
export const parseRunnerConfig = Effect.fn("Runner.parseConfig")(
  function*(
    env: Readonly<Record<string, string | undefined>>
  ): Effect.fn.Return<RunnerConfig, RunnerConfigError> {
    const apiUrl = env.OTBOR_API_URL?.trim()
    const runnerId = yield* required(env, "OTBOR_RUNNER_ID")
    const token = yield* required(env, "OTBOR_RUNNER_TOKEN")
    const waitSeconds = yield* waitSecondsValue(env.OTBOR_RUNNER_WAIT_SECONDS)
    const concurrency = yield* concurrencyValue(env.OTBOR_RUNNER_CONCURRENCY)

    const decoded = yield* Schema.decodeUnknownEffect(RunnerConfig)({
      apiUrl: apiUrl === undefined || apiUrl.length === 0 ? DEFAULT_API_URL : apiUrl,
      runnerId,
      token,
      kinds: commaList(env.OTBOR_RUNNER_KINDS, ["inference"]),
      accounts: commaList(env.OTBOR_RUNNER_ACCOUNTS, []),
      waitSeconds,
      concurrency,
      once: false
    }).pipe(
      Effect.mapError(
        (error) =>
          new RunnerConfigError({
            message: `invalid runner configuration: ${error.message}`
          })
      )
    )

    return decoded
  }
)
