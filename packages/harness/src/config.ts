import {
  HhAccountId as HhAccountIdSchema,
  HarnessId as HarnessIdSchema,
  JobKind
} from "@otbor/contract"
import { Effect, Schema } from "effect"

export const DEFAULT_API_URL = "http://127.0.0.1:3001/rpc"
export const DEFAULT_WAIT_SECONDS = 30

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

const booleanValue = (
  value: string | undefined,
  name: string
): Effect.Effect<boolean, HarnessConfigError> => {
  if (value === undefined) return Effect.succeed(false)
  switch (value.trim().toLowerCase()) {
    case "":
    case "0":
    case "false":
    case "no":
    case "off":
      return Effect.succeed(false)
    case "1":
    case "true":
    case "yes":
    case "on":
      return Effect.succeed(true)
    default:
      return Effect.fail(
        new HarnessConfigError({
          message: `${name} must be one of true/false, 1/0, yes/no, on/off`
        })
      )
  }
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
    const once = yield* booleanValue(env.OTBOR_HARNESS_ONCE, "OTBOR_HARNESS_ONCE")
    const waitSeconds = yield* waitSecondsValue(env.OTBOR_HARNESS_WAIT_SECONDS)

    const decoded = yield* Schema.decodeUnknownEffect(HarnessConfig)({
      apiUrl: apiUrl === undefined || apiUrl.length === 0 ? DEFAULT_API_URL : apiUrl,
      harnessId,
      token,
      kinds: commaList(env.OTBOR_HARNESS_KINDS, ["inference"]),
      accounts: commaList(env.OTBOR_HARNESS_ACCOUNTS, []),
      waitSeconds,
      once
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
