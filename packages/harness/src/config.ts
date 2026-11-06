import {
  HhAccountId as HhAccountIdSchema,
  HarnessId as HarnessIdSchema,
  JobKind
} from "@otbor/contract"
import { Effect, Schema } from "effect"

export const DEFAULT_API_URL = "http://127.0.0.1:3001/rpc"
export const DEFAULT_WAIT_SECONDS = 30
/** Jobs one harness runs at the same time. */
export const DEFAULT_CONCURRENCY = 3
export const MAX_CONCURRENCY = 8

/** Configuration errors are answers, not crashes: print the message and exit. */
export class HarnessConfigError extends Schema.TaggedError<HarnessConfigError>()(
  "HarnessConfigError",
  {
    message: Schema.String
  }
) {}

const HarnessConfig = Schema.Struct({
  apiUrl: Schema.String,
  harnessId: HarnessIdSchema,
  token: Schema.String,
  kinds: Schema.Array(JobKind),
  accounts: Schema.Array(HhAccountIdSchema),
  waitSeconds: Schema.Int,
  concurrency: Schema.Int,
  once: Schema.Boolean
})

export type HarnessConfig = typeof HarnessConfig.Type

const required = (
  env: Readonly<Record<string, string | undefined>>,
  name: string
): Effect.Effect<string, HarnessConfigError> => {
  const value = env[name]?.trim()
  return value === undefined || value.length === 0
    ? Effect.fail(new HarnessConfigError({ message: `${name} is required` }))
    : Effect.succeed(value)
}

/**
 * A comma separated list. An empty or whitespace-only value means "not set", so
 * the fallback applies: omitting `OTBOR_HARNESS_KINDS` defaults to inference,
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
): Effect.Effect<number, HarnessConfigError> => {
  if (value === undefined || value.trim() === "") {
    return Effect.succeed(DEFAULT_WAIT_SECONDS)
  }
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= DEFAULT_WAIT_SECONDS
    ? Effect.succeed(parsed)
    : Effect.fail(
        new HarnessConfigError({
          message: `OTBOR_HARNESS_WAIT_SECONDS must be an integer between 0 and ${DEFAULT_WAIT_SECONDS}`
        })
      )
}

const concurrencyValue = (
  value: string | undefined
): Effect.Effect<number, HarnessConfigError> => {
  if (value === undefined || value.trim() === "") return Effect.succeed(DEFAULT_CONCURRENCY)
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CONCURRENCY
    ? Effect.succeed(parsed)
    : Effect.fail(
        new HarnessConfigError({
          message: `OTBOR_HARNESS_CONCURRENCY must be an integer between 1 and ${MAX_CONCURRENCY}`
        })
      )
}

/**
 * Pure env parsing so the run loop can be tested without touching process.env.
 * The final object still goes through Schema: the IDs, kinds, accounts and
 * ranges are validated in one place.
 */
export const parseHarnessConfig = Effect.fn("Harness.parseConfig")(
  function*(
    env: Readonly<Record<string, string | undefined>>
  ): Effect.fn.Return<HarnessConfig, HarnessConfigError> {
    const apiUrl = env.OTBOR_API_URL?.trim()
    const harnessId = yield* required(env, "OTBOR_HARNESS_ID")
    const token = yield* required(env, "OTBOR_HARNESS_TOKEN")
    const waitSeconds = yield* waitSecondsValue(env.OTBOR_HARNESS_WAIT_SECONDS)
    const concurrency = yield* concurrencyValue(env.OTBOR_HARNESS_CONCURRENCY)

    const decoded = yield* Schema.decodeUnknownEffect(HarnessConfig)({
      apiUrl: apiUrl === undefined || apiUrl.length === 0 ? DEFAULT_API_URL : apiUrl,
      harnessId,
      token,
      kinds: commaList(env.OTBOR_HARNESS_KINDS, ["inference"]),
      accounts: commaList(env.OTBOR_HARNESS_ACCOUNTS, []),
      waitSeconds,
      concurrency,
      once: false
    }).pipe(
      Effect.mapError(
        (error) =>
          new HarnessConfigError({
            message: `invalid harness configuration: ${error.message}`
          })
      )
    )

    return decoded
  }
)
