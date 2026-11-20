import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  DEFAULT_API_URL,
  DEFAULT_CONCURRENCY,
  DEFAULT_WAIT_SECONDS,
  parseRunnerConfig
} from "../src/config.ts"

const RUNNER_ID = "0190c8f5-8c2b-7abc-8def-0123456789ab"
const ACCOUNT_A = "0190c8f5-8c2b-7abc-8def-0123456789cd"
const ACCOUNT_B = "0190c8f5-8c2b-7abc-8def-0123456789ef"

const baseEnv = {
  OTBOR_RUNNER_ID: RUNNER_ID,
  OTBOR_RUNNER_TOKEN: "device-token"
}

const parse = (env: Readonly<Record<string, string | undefined>>) =>
  Effect.runPromise(parseRunnerConfig(env))

const parseError = (env: Readonly<Record<string, string | undefined>>) =>
  Effect.runPromise(parseRunnerConfig(env).pipe(Effect.flip))

describe("parseRunnerConfig", () => {
  test("defaults to the local RPC URL, inference kind and a 30s lease wait", async () => {
    const config = await parse(baseEnv)

    expect(config.apiUrl).toBe(DEFAULT_API_URL)
    expect(config.runnerId as string).toBe(RUNNER_ID)
    expect(config.token).toBe("device-token")
    expect(config.kinds).toEqual(["inference"])
    expect(config.accounts).toEqual([])
    expect(config.waitSeconds).toBe(DEFAULT_WAIT_SECONDS)
    expect(config.once).toBe(false)
    expect(config.concurrency).toBe(DEFAULT_CONCURRENCY)
  })

  test("concurrency is read from the environment and bounded", async () => {
    expect((await parse({ ...baseEnv, OTBOR_RUNNER_CONCURRENCY: "5" })).concurrency).toBe(5)
    for (const value of ["0", "13", "x", "1.5"]) {
      const error = await parseError({ ...baseEnv, OTBOR_RUNNER_CONCURRENCY: value })
      expect(error.message).toContain("OTBOR_RUNNER_CONCURRENCY")
    }
  })

  test("accepts a custom API URL and comma separated kinds and accounts", async () => {
    const config = await parse({
      ...baseEnv,
      OTBOR_API_URL: "http://runner.local:9000/rpc",
      OTBOR_RUNNER_KINDS: "inference, browser",
      OTBOR_RUNNER_ACCOUNTS: `${ACCOUNT_A}, ${ACCOUNT_B}`,
      OTBOR_RUNNER_WAIT_SECONDS: "0"
    })

    expect(config.apiUrl).toBe("http://runner.local:9000/rpc")
    expect(config.kinds).toEqual(["inference", "browser"])
    expect(config.accounts.map(String)).toEqual([ACCOUNT_A, ACCOUNT_B])
    expect(config.waitSeconds).toBe(0)
  })

  test("an empty list means the default, not an empty kind set", async () => {
    const config = await parse({
      ...baseEnv,
      OTBOR_RUNNER_KINDS: " , ",
      OTBOR_RUNNER_ACCOUNTS: " "
    })

    expect(config.kinds).toEqual(["inference"])
    expect(config.accounts).toEqual([])
  })

  test("requires the driver id and the device token", async () => {
    const noId = await parseError({ OTBOR_RUNNER_TOKEN: "token" })
    expect(noId._tag).toBe("RunnerConfigError")
    expect(noId.message).toContain("OTBOR_RUNNER_ID is required")

    const noToken = await parseError({ OTBOR_RUNNER_ID: RUNNER_ID })
    expect(noToken.message).toContain("OTBOR_RUNNER_TOKEN is required")

    const blankToken = await parseError({
      OTBOR_RUNNER_ID: RUNNER_ID,
      OTBOR_RUNNER_TOKEN: "   "
    })
    expect(blankToken.message).toContain("OTBOR_RUNNER_TOKEN is required")
  })

  test("rejects an unknown job kind", async () => {
    const error = await parseError({ ...baseEnv, OTBOR_RUNNER_KINDS: "inference,browser,email" })
    expect(error.message).toContain("invalid runner configuration")
  })

  test("rejects an invalid account id", async () => {
    const error = await parseError({ ...baseEnv, OTBOR_RUNNER_ACCOUNTS: "not-a-uuid" })
    expect(error.message).toContain("invalid runner configuration")
  })

  test("rejects an invalid runner id", async () => {
    const error = await parseError({
      ...baseEnv,
      OTBOR_RUNNER_ID: "00000000-0000-4000-8000-000000000000"
    })
    expect(error.message).toContain("invalid runner configuration")
  })

  test("wait seconds must be an integer between 0 and 30", async () => {
    for (const value of ["-1", "31", "1.5", "soon"]) {
      const error = await parseError({ ...baseEnv, OTBOR_RUNNER_WAIT_SECONDS: value })
      expect(error.message).toContain("OTBOR_RUNNER_WAIT_SECONDS")
    }

    const accepted = await parse({ ...baseEnv, OTBOR_RUNNER_WAIT_SECONDS: "30" })
    expect(accepted.waitSeconds).toBe(30)
  })

})
