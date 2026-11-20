import { RunnerJob, type RunnerExit } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Ref, Schema } from "effect"
import { BrowserDriver } from "../src/browser/driver.ts"
import { RunnerGateway, type RunnerGatewayShape } from "../src/client.ts"
import { parseRunnerConfig } from "../src/config.ts"
import { runJob } from "../src/run.ts"

const RUNNER_ID = "0190c8f5-8c2b-7abc-8def-0123456789ab"
const JOB_ID = "0190c8f5-8c2b-7abc-8def-0123456789cd"
const LEASE_ID = "0190c8f5-8c2b-7abc-8def-0123456789ef"

const makeJob = (stage: string, payload: unknown) =>
  Schema.decodeUnknownSync(RunnerJob)({
    id: JOB_ID,
    kind: "browser",
    stage,
    status: "leased",
    priority: 0,
    payload,
    result: null,
    attempts: 1,
    maxAttempts: stage === "submit" ? 1 : 3,
    leaseId: LEASE_ID,
    leaseEpoch: 4,
    leaseUntil: "2026-11-02T00:00:00.000Z",
    runAt: "2026-11-02T00:00:00.000Z",
    createdAt: "2026-11-02T00:00:00.000Z"
  })

const config = () =>
  Effect.runPromise(
    parseRunnerConfig({
      OTBOR_RUNNER_ID: RUNNER_ID,
      OTBOR_RUNNER_TOKEN: "device-token",
      OTBOR_RUNNER_KINDS: "browser"
    })
  )

const gateway = (overrides: Partial<RunnerGatewayShape> = {}) =>
  Layer.succeed(RunnerGateway)(
    RunnerGateway.of({
      leaseNext: () => Effect.die("leaseNext"),
      heartbeat: () => Effect.succeed({ ok: true, reason: null }),
      complete: () => Effect.die("complete"),
      reportCatalog: () => Effect.succeed({ ok: true }),
      ...overrides
    })
  )

const target = {
  applicationId: "app",
  vacancyId: "vac",
  externalId: "100500",
  canonicalUrl: "https://hh.ru/vacancy/100500",
  sessionProfile: "acc"
}

const submitPayload = {
  ...target,
  kitId: "kit",
  expectedFormHash: "abc",
  kit: { formHash: "abc", letter: null, answers: [] }
}

describe("runJob with a browser driver", () => {
  test("prepare is handed to the driver and its exit is reported", async () => {
    const seen = await Effect.runPromise(Ref.make<ReadonlyArray<string>>([]))
    const exit: RunnerExit = { tag: "prepared", artifacts: { url: "u", html: "<form/>" } }

    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("prepare", target), {
        driverLayer: BrowserDriver.fake({
          prepare: (payload) =>
            Ref.update(seen, (list) => [...list, payload.externalId]).pipe(Effect.as(exit))
        })
      }).pipe(Effect.provide(gateway()))
    )

    expect(outcome).toEqual({ _tag: "complete", exit })
    expect(await Effect.runPromise(Ref.get(seen))).toEqual(["100500"])
  })

  test("submit gets a before-click check that heartbeats with the job's lease and epoch", async () => {
    const beats = await Effect.runPromise(
      Ref.make<ReadonlyArray<{ jobId: string; leaseId: string; epoch: number }>>([])
    )
    const checked = { value: false }

    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("submit", submitPayload), {
        heartbeatEvery: Duration.minutes(5),
        driverLayer: BrowserDriver.fake({
          submit: ({ beforeClick }) =>
            Effect.gen(function*() {
              checked.value = yield* beforeClick
              return { tag: "clicked" } satisfies RunnerExit
            })
        })
      }).pipe(
        Effect.provide(
          gateway({
            heartbeat: (input) =>
              Ref.update(beats, (list) => [
                ...list,
                { jobId: input.jobId, leaseId: input.leaseId, epoch: input.epoch }
              ]).pipe(Effect.as({ ok: true, reason: null }))
          })
        )
      )
    )

    expect(outcome._tag).toBe("complete")
    expect(checked.value).toBe(true)
    expect(await Effect.runPromise(Ref.get(beats))).toEqual([
      { jobId: JOB_ID, leaseId: LEASE_ID, epoch: 4 }
    ])
  })

  test("a lost lease at the check tells the driver not to click", async () => {
    const allowed: { value: boolean | null } = { value: null }
    await Effect.runPromise(
      runJob(await config(), makeJob("submit", submitPayload), {
        heartbeatEvery: Duration.minutes(5),
        driverLayer: BrowserDriver.fake({
          submit: ({ beforeClick }) =>
            Effect.gen(function*() {
              allowed.value = yield* beforeClick
              return { tag: "transport" } satisfies RunnerExit
            })
        })
      }).pipe(
        Effect.provide(gateway({ heartbeat: () => Effect.succeed({ ok: false, reason: "lost" }) }))
      )
    )
    expect(allowed.value).toBe(false)
  })

  test("a lease lost during the work stops it without completing", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("submit", submitPayload), {
        heartbeatEvery: Duration.millis(10),
        driverLayer: BrowserDriver.fake({
          submit: () => Effect.sleep("5 seconds").pipe(Effect.as({ tag: "clicked" } satisfies RunnerExit))
        })
      }).pipe(
        Effect.provide(gateway({ heartbeat: () => Effect.succeed({ ok: false, reason: "superseded" }) }))
      )
    )
    expect(outcome._tag).toBe("lease_lost")
  })

  test("an invalid submit payload is reported as an unclicked permanent failure", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("submit", { nonsense: true }), {
        driverLayer: BrowserDriver.fake()
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome._tag).toBe("complete")
    if (outcome._tag !== "complete") return
    expect(outcome.exit.tag).toBe("permanent")
    expect(outcome.exit.artifacts).toMatchObject({ clicked: false })
  })

  test("reconcile is handed to the driver and its evidence is reported untouched", async () => {
    const seen = await Effect.runPromise(Ref.make<ReadonlyArray<string>>([]))
    const exit: RunnerExit = {
      tag: "reconciled",
      artifacts: { externalId: "100500", negotiations: [] }
    }
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("reconcile", target), {
        driverLayer: BrowserDriver.fake({
          reconcile: (payload) =>
            Ref.update(seen, (list) => [...list, payload.externalId]).pipe(Effect.as(exit)),
          // A reconcile must never reach the submit routine.
          submit: () => Effect.die("reconcile called submit")
        })
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome).toEqual({ _tag: "complete", exit })
    expect(await Effect.runPromise(Ref.get(seen))).toEqual(["100500"])
  })

  test("an invalid reconcile payload is a permanent failure and touches no driver", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("reconcile", { nonsense: true }), {
        driverLayer: BrowserDriver.fake({ reconcile: () => Effect.die("must not run") })
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome._tag === "complete" && outcome.exit.tag).toBe("permanent")
  })

  test("negotiations_sync is handed to the driver and never reaches submit", async () => {
    const seen = await Effect.runPromise(Ref.make<ReadonlyArray<string>>([]))
    const exit: RunnerExit = { tag: "reconciled", artifacts: { pages: [] } }
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("negotiations_sync", { hhAccountId: "acc", maxPages: 3 }), {
        driverLayer: BrowserDriver.fake({
          negotiationsSync: (payload) =>
            Ref.update(seen, (list) => [...list, payload.hhAccountId]).pipe(Effect.as(exit)),
          submit: () => Effect.die("sync called submit")
        })
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome).toEqual({ _tag: "complete", exit })
    expect(await Effect.runPromise(Ref.get(seen))).toEqual(["acc"])
  })

  test("an invalid negotiations_sync payload is a permanent failure", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("negotiations_sync", { nonsense: true }), {
        driverLayer: BrowserDriver.fake({ negotiationsSync: () => Effect.die("must not run") })
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome._tag === "complete" && outcome.exit.tag).toBe("permanent")
  })

  test("resume_bump передаётся исполнителю с проверкой аренды перед нажатием", async () => {
    const seen: { hash: string | null; allowed: boolean | null } = { hash: null, allowed: null }
    const exit: RunnerExit = { tag: "blocked", message: "bump not available: x" }
    const outcome = await Effect.runPromise(
      runJob(
        await config(),
        makeJob("resume_bump", {
          hhAccountId: "acc",
          resumeId: "r1",
          externalId: "555",
          hash: "abc123",
          canonicalUrl: "https://hh.ru/resume/abc123",
          sessionProfile: "acc"
        }),
        {
          driverLayer: BrowserDriver.fake({
            resumeBump: ({ payload, beforeClick }) =>
              Effect.gen(function*() {
                seen.hash = payload.hash
                seen.allowed = yield* beforeClick
                return exit
              }),
            submit: () => Effect.die("bump called submit")
          })
        }
      ).pipe(Effect.provide(gateway()))
    )
    expect(outcome).toEqual({ _tag: "complete", exit })
    expect(seen).toEqual({ hash: "abc123", allowed: true })
  })

  test("неверная нагрузка resume_bump: permanent, исполнитель не вызывается", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("resume_bump", { nonsense: true }), {
        driverLayer: BrowserDriver.fake({ resumeBump: () => Effect.die("must not run") })
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome._tag === "complete" && outcome.exit.tag).toBe("permanent")
  })

  test("a session job still has no browser routine and is blocked", async () => {
    const outcome = await Effect.runPromise(
      runJob(await config(), makeJob("session", target), {
        driverLayer: BrowserDriver.fake()
      }).pipe(Effect.provide(gateway()))
    )
    expect(outcome._tag === "complete" && outcome.exit.tag).toBe("blocked")
  })
})
