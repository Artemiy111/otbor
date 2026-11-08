import { AcpClient, type AcpEvent, type AcpSessionInfo } from "@otbor/acp"
import { HarnessJob, type HarnessExit } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Ref, Schema, Stream } from "effect"
import {
  HarnessGateway,
  HarnessGatewayError,
  type HarnessGatewayShape
} from "../src/client.ts"
import { parseHarnessConfig } from "../src/config.ts"
import {
  BROWSER_UNAVAILABLE_MESSAGE,
  reportCatalogOnce,
  runHarness,
  runJob
} from "../src/run.ts"

const HARNESS_ID = "0190c8f5-8c2b-7abc-8def-0123456789ab"
const JOB_ID = "0190c8f5-8c2b-7abc-8def-0123456789cd"
const LEASE_ID = "0190c8f5-8c2b-7abc-8def-0123456789ef"

const makeJob = (overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(HarnessJob)({
    id: JOB_ID,
    kind: "inference",
    stage: "inference",
    status: "leased",
    priority: 100,
    payload: { prompt: "hello" },
    result: null,
    attempts: 1,
    maxAttempts: 3,
    leaseId: LEASE_ID,
    leaseEpoch: 1,
    leaseUntil: "2026-11-02T00:00:00.000Z",
    runAt: "2026-11-02T00:00:00.000Z",
    createdAt: "2026-11-02T00:00:00.000Z",
    ...overrides
  })

const makeConfig = (
  overrides: Record<string, string | undefined> = {},
  once = false
) =>
  Effect.runPromise(
    parseHarnessConfig({
      OTBOR_HARNESS_ID: HARNESS_ID,
      OTBOR_HARNESS_TOKEN: "device-token",
      ...overrides
    }).pipe(Effect.map((config) => ({ ...config, once })))
  )

const gatewayLayer = (overrides: Partial<HarnessGatewayShape>) =>
  Layer.succeed(HarnessGateway)(
    HarnessGateway.of({
      leaseNext: () => Effect.die("leaseNext should not be called"),
      heartbeat: () => Effect.die("heartbeat should not be called"),
      complete: () => Effect.die("complete should not be called"),
      reportCatalog: () => Effect.succeed({ ok: true }),
      ...overrides
    })
  )

const session: AcpSessionInfo = {
  sessionId: "session-1",
  protocolVersion: 1,
  agent: { name: "fake" },
  configOptions: [{ id: "model", currentValue: "fake/model" }]
}

const doneEvent: AcpEvent = {
  _tag: "Done",
  text: "answer",
  sessionId: "session-1",
  stopReason: "end_turn",
  usage: null,
  providerResponse: null,
  providerUsage: null,
  durationMs: 5
}

const slowAcpLayer = (delay: Duration.Input): Layer.Layer<AcpClient> =>
  Layer.succeed(AcpClient)(
    AcpClient.of({
      prompt: () => Effect.succeed("answer"),
      promptEvents: () =>
        Stream.fromEffect(Effect.sleep(delay)).pipe(Stream.map(() => doneEvent)),
      sessionId: Effect.succeed(session.sessionId),
      session: Effect.succeed(session),
      setConfigOption: () => Effect.void
    })
  )

describe("runJob", () => {
  test("a browser job is completed as blocked with a clear message", async () => {
    const config = await makeConfig()
    const job = makeJob({ kind: "browser", stage: "prepare" })

    const outcome = await Effect.runPromise(
      runJob(config, job).pipe(Effect.provide(gatewayLayer({})))
    )

    expect(outcome._tag).toBe("complete")
    if (outcome._tag !== "complete") return
    expect(outcome.exit.tag).toBe("blocked")
    expect(outcome.exit.message).toBe(BROWSER_UNAVAILABLE_MESSAGE)
  })

  test("a job without a lease is skipped instead of completed", async () => {
    const config = await makeConfig()
    const job = makeJob({ leaseId: null })

    const outcome = await Effect.runPromise(
      runJob(config, job).pipe(Effect.provide(gatewayLayer({})))
    )

    expect(outcome._tag).toBe("skip")
  })

  test("heartbeats while the prompt runs and reports prepared", async () => {
    const config = await makeConfig()
    const job = makeJob()
    const pings = await Effect.runPromise(Ref.make(0))

    const outcome = await Effect.runPromise(
      runJob(config, job, {
        heartbeatEvery: Duration.millis(10),
        acpLayer: slowAcpLayer(Duration.millis(60))
      }).pipe(
        Effect.provide(
          gatewayLayer({
            heartbeat: () =>
              Ref.update(pings, (count) => count + 1).pipe(
                Effect.as({ ok: true, reason: null })
              )
          })
        )
      )
    )

    expect(outcome._tag).toBe("complete")
    if (outcome._tag !== "complete") return
    expect(outcome.exit.tag).toBe("prepared")
    expect(await Effect.runPromise(Ref.get(pings))).toBeGreaterThan(0)
  })

  test("a lost lease stops the prompt without completing it", async () => {
    const config = await makeConfig()
    const job = makeJob()

    const outcome = await Effect.runPromise(
      runJob(config, job, {
        heartbeatEvery: Duration.millis(10),
        acpLayer: slowAcpLayer(Duration.seconds(5))
      }).pipe(
        Effect.provide(
          gatewayLayer({
            heartbeat: () => Effect.succeed({ ok: false, reason: "lease expired" })
          })
        )
      )
    )

    expect(outcome._tag).toBe("lease_lost")
    if (outcome._tag !== "lease_lost") return
    expect(outcome.reason).toBe("lease expired")
  })

  test("a failing heartbeat also stops the prompt", async () => {
    const config = await makeConfig()
    const job = makeJob()

    const outcome = await Effect.runPromise(
      runJob(config, job, {
        heartbeatEvery: Duration.millis(10),
        acpLayer: slowAcpLayer(Duration.seconds(5))
      }).pipe(
        Effect.provide(
          gatewayLayer({
            heartbeat: () =>
              Effect.fail(
                new HarnessGatewayError({ message: "connection reset" })
              )
          })
        )
      )
    )

    expect(outcome._tag).toBe("lease_lost")
    if (outcome._tag !== "lease_lost") return
    expect(outcome.reason).toContain("connection reset")
  })
})

describe("runHarness", () => {
  test("once mode leases one job, completes it and returns", async () => {
    const config = await makeConfig({}, true)
    const job = makeJob({ kind: "browser", stage: "prepare" })
    const exits = await Effect.runPromise(Ref.make<ReadonlyArray<HarnessExit>>([]))
    let leases = 0

    await Effect.runPromise(
      runHarness(config).pipe(
        Effect.provide(
          gatewayLayer({
            leaseNext: () => {
              leases += 1
              return Effect.succeed({ job })
            },
            complete: (input) =>
              Ref.update(exits, (all) => [...all, input.exit]).pipe(
                Effect.as({ status: "needs_human", accepted: true, message: "queued" })
              )
          })
        )
      )
    )

    expect(leases).toBe(1)
    const completed = await Effect.runPromise(Ref.get(exits))
    expect(completed).toHaveLength(1)
    expect(completed[0]?.tag).toBe("blocked")
  })

  test("runs `concurrency` lease loops at once", async () => {
    const config = await makeConfig({ OTBOR_HARNESS_CONCURRENCY: "3" })
    const job = makeJob({ kind: "browser", stage: "prepare" })
    let leases = 0
    let inFlight = 0
    let peak = 0

    // Each loop blocks inside leaseNext until the third one has arrived, so the
    // peak is 3 only if three loops run side by side. The fiber is then stopped.
    const fiber = Effect.runFork(
      runHarness(config).pipe(
        Effect.provide(
          gatewayLayer({
            leaseNext: () =>
              Effect.gen(function*() {
                leases += 1
                inFlight += 1
                peak = Math.max(peak, inFlight)
                yield* Effect.sleep(Duration.millis(60))
                inFlight -= 1
                return { job: null }
              })
          })
        )
      )
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    await Effect.runPromise(Effect.sync(() => fiber.interruptUnsafe()))
    expect(peak).toBe(3)
    expect(leases).toBeGreaterThanOrEqual(3)
  })

  test("the pool follows `harnessSlots` from the cloud at runtime, up and down, and keeps the config value without one", async () => {
    const config = await makeConfig({ OTBOR_HARNESS_CONCURRENCY: "2" })
    let wanted: number | undefined
    let inFlight = 0
    let peak = 0
    const reported: Array<number | undefined> = []

    const fiber = Effect.runFork(
      runHarness(config).pipe(
        Effect.provide(
          gatewayLayer({
            leaseNext: (input) =>
              Effect.gen(function*() {
                reported.push(input.concurrency)
                inFlight += 1
                peak = Math.max(peak, inFlight)
                yield* Effect.sleep(Duration.millis(40))
                inFlight -= 1
                return { job: null, ...(wanted === undefined ? {} : { harnessSlots: wanted }) }
              })
          })
        )
      )
    )
    const measure = async (): Promise<number> => {
      peak = 0
      await new Promise((resolve) => setTimeout(resolve, 200))
      return peak
    }

    // Облако молчит: остаётся значение конфигурации.
    expect(await measure()).toBe(2)

    // Облако увеличило потоки: спящие циклы просыпаются (проверка раз в секунду).
    wanted = 5
    await new Promise((resolve) => setTimeout(resolve, 100))
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    expect(await measure()).toBe(5)

    // И уменьшило: лишние циклы доделывают начатое и засыпают.
    wanted = 1
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await measure()).toBe(1)
    // Харнесс сообщает облаку то число, что держит сейчас.
    expect(reported.at(-1)).toBe(1)

    // Значение вне границ сжимается до 1..12.
    wanted = 99
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(await measure()).toBe(12)

    await Effect.runPromise(Effect.sync(() => fiber.interruptUnsafe()))
  }, 15_000)

  test("once mode returns after an empty lease without completing anything", async () => {
    const config = await makeConfig({}, true)
    let leases = 0

    await Effect.runPromise(
      runHarness(config).pipe(
        Effect.provide(
          gatewayLayer({
            leaseNext: () => {
              leases += 1
              return Effect.succeed({ job: null })
            }
          })
        )
      )
    )

    expect(leases).toBe(1)
  })
})

describe("reportCatalogOnce", () => {
  const catalog = [
    { id: "claude", name: "Claude Code", available: true, error: null, models: [], defaultModel: null }
  ]

  test("sends the probed catalog with the device token", async () => {
    const sent: Array<unknown> = []
    const config = await makeConfig({ OTBOR_HARNESS_KINDS: "inference" })
    await Effect.runPromise(
      reportCatalogOnce(config, { probe: Effect.succeed(catalog) }).pipe(
        Effect.provide(
          gatewayLayer({
            reportCatalog: (input) => {
              sent.push(input)
              return Effect.succeed({ ok: true })
            }
          })
        )
      )
    )

    expect(sent).toEqual([{ harnessId: config.harnessId, token: "device-token", harnesses: catalog }])
  })

  test("a failing report is swallowed so the harness keeps running", async () => {
    const config = await makeConfig({ OTBOR_HARNESS_KINDS: "inference" })
    await Effect.runPromise(
      reportCatalogOnce(config, { probe: Effect.succeed(catalog) }).pipe(
        Effect.provide(
          gatewayLayer({
            reportCatalog: () =>
              Effect.fail(new HarnessGatewayError({ message: "report catalog: down" }))
          })
        )
      )
    )
  })
})
