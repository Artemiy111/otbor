import { AcpClient } from "@otbor/acp"
import {
  type HarnessExit,
  type HarnessJob,
  type LeaseId,
  PrepareJobPayload,
  ReconcileJobPayload,
  SubmitJobPayload
} from "@otbor/contract"
import { Deferred, Duration, Effect, Fiber, type Layer, Option, Schema } from "effect"
import { BrowserExecutor } from "./browser/executor.ts"
import { HarnessGateway } from "./client.ts"
import type { HarnessConfig } from "./config.ts"
import { runInferenceExit } from "./inference.ts"

/** The cloud lease is 120s; a third of it keeps a slow prompt alive. */
export const HEARTBEAT_INTERVAL = Duration.seconds(30)
const RETRY_DELAY = Duration.seconds(5)

export const BROWSER_UNAVAILABLE_MESSAGE =
  "browser executor is not part of this harness build; only inference jobs are supported"

export const BROWSER_STAGE_UNSUPPORTED_MESSAGE =
  "this harness has no browser routine for the stage yet"

/**
 * `complete` means "report this exit". The other outcomes deliberately do not
 * complete: a lost lease belongs to another performer, and a job without a
 * lease id cannot be fenced.
 */
export type JobOutcome =
  | { readonly _tag: "complete"; readonly exit: HarnessExit }
  | { readonly _tag: "lease_lost"; readonly reason: string }
  | { readonly _tag: "skip"; readonly reason: string }

const heartbeatLoop = (
  gateway: HarnessGateway["Service"],
  config: HarnessConfig,
  job: HarnessJob,
  leaseId: LeaseId,
  interval: Duration.Input,
  lost: Deferred.Deferred<string>
) =>
  Effect.gen(function*() {
    while (true) {
      yield* Effect.sleep(interval)
      const result = yield* gateway
        .heartbeat({
          harnessId: config.harnessId,
          token: config.token,
          jobId: job.id,
          leaseId,
          epoch: job.leaseEpoch
        })
        .pipe(
          Effect.catchTag("HarnessGatewayError", (error) =>
            Effect.succeed({
              ok: false,
              reason: `heartbeat failed: ${error.message}`
            })
          )
        )

      if (!result.ok) {
        yield* Effect.logWarning(
          `job ${job.id}: stopping without completion: ${result.reason ?? "lease lost"}`
        )
        yield* Deferred.succeed(lost, result.reason ?? "lease lost")
        return
      }
    }
  })

/**
 * Test seam: production uses `AcpClient.layer` (one agent process per job),
 * while unit tests inject a fake ACP layer and a short heartbeat interval.
 */
export interface RunJobOptions {
  readonly heartbeatEvery?: Duration.Input
  readonly acpLayer?: Layer.Layer<AcpClient>
  /** Browser work. Without one, browser jobs are answered as blocked. */
  readonly browserLayer?: Layer.Layer<BrowserExecutor>
}

const badPayload = (stage: string, message: string): HarnessExit => ({
  tag: "permanent",
  message: `invalid ${stage} payload: ${message}`,
  // Nothing was touched, so a submit can be told apart from one that clicked.
  artifacts: { clicked: false, url: "", marker: "none" }
})

/**
 * Browser work for one job. Prepare reads the response form; submit fills it
 * and presses the button once. The lease is re-checked with a heartbeat right
 * before the click, and an interrupted effect closes the browser.
 */
const runBrowserExit = (
  config: HarnessConfig,
  job: HarnessJob,
  leaseId: LeaseId,
  gateway: HarnessGateway["Service"],
  executor: BrowserExecutor["Service"]
): Effect.Effect<HarnessExit> => {
  switch (job.stage) {
    case "prepare":
      return Schema.decodeUnknownEffect(PrepareJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(badPayload("prepare", error.message)),
          onSuccess: (payload) => executor.prepare(payload)
        })
      )
    case "submit":
      return Schema.decodeUnknownEffect(SubmitJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(badPayload("submit", error.message)),
          onSuccess: (payload) =>
            executor.submit({
              payload,
              beforeClick: gateway
                .heartbeat({
                  harnessId: config.harnessId,
                  token: config.token,
                  jobId: job.id,
                  leaseId,
                  epoch: job.leaseEpoch
                })
                .pipe(
                  Effect.map((result) => result.ok),
                  Effect.orElseSucceed(() => false)
                )
            })
        })
      )
    case "reconcile":
      return Schema.decodeUnknownEffect(ReconcileJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // A reconcile never clicks, so a bad payload touched nothing.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid reconcile payload: ${error.message}`
            }),
          onSuccess: (payload) => executor.reconcile(payload)
        })
      )
    default:
      return Effect.succeed({
        tag: "blocked",
        message: `${BROWSER_STAGE_UNSUPPORTED_MESSAGE}: ${job.stage}`
      })
  }
}

/**
 * Run one leased job. Inference owns the ACP session in a layer scoped to this
 * job, so the agent process is released even when the prompt fails. Browser
 * jobs go to the `BrowserExecutor` when the harness was built with one and are
 * answered as blocked otherwise; the cloud, not the harness, decides what to
 * do with that.
 */
export const runJob = Effect.fn("Harness.runJob")(
  function*(
    config: HarnessConfig,
    job: HarnessJob,
    options: RunJobOptions = {}
  ): Effect.fn.Return<JobOutcome, never, HarnessGateway> {
    const leaseId = job.leaseId
    if (leaseId === null) {
      return {
        _tag: "skip",
        reason: "leased job has no lease id; cannot heartbeat or complete"
      }
    }

    const gateway = yield* HarnessGateway
    const lost = yield* Deferred.make<string>()

    let work: Effect.Effect<JobOutcome>
    if (job.kind === "browser") {
      const executor = options.browserLayer === undefined
        ? Option.none<BrowserExecutor["Service"]>()
        : Option.some(yield* BrowserExecutor.pipe(Effect.provide(options.browserLayer)))
      if (Option.isNone(executor)) {
        return {
          _tag: "complete",
          exit: { tag: "blocked", message: BROWSER_UNAVAILABLE_MESSAGE }
        }
      }
      work = runBrowserExit(config, job, leaseId, gateway, executor.value).pipe(
        Effect.map((exit): JobOutcome => ({ _tag: "complete", exit }))
      )
    } else {
      work = runInferenceExit(job.payload).pipe(
        Effect.provide(options.acpLayer ?? AcpClient.layer),
        Effect.catchTag("ConfigError", (error) =>
          Effect.succeed<HarnessExit>({
            tag: "inference_failed",
            message: `ACP configuration error: ${error.message}`
          })
        ),
        Effect.map((exit): JobOutcome => ({ _tag: "complete", exit }))
      )
    }

    const leaseLost = Deferred.await(lost).pipe(
      Effect.map((reason): JobOutcome => ({ _tag: "lease_lost", reason }))
    )

    const pulse = yield* Effect.forkChild(
      heartbeatLoop(
        gateway,
        config,
        job,
        leaseId,
        options.heartbeatEvery ?? HEARTBEAT_INTERVAL,
        lost
      )
    )

    return yield* Effect.raceFirst(work, leaseLost).pipe(
      Effect.onExit(() => Fiber.interrupt(pulse))
    )
  }
)

const deliver = (config: HarnessConfig, job: HarnessJob, exit: HarnessExit) =>
  Effect.gen(function*() {
    const leaseId = job.leaseId
    if (leaseId === null) return

    const gateway = yield* HarnessGateway
    const result = yield* gateway.complete({
      harnessId: config.harnessId,
      token: config.token,
      jobId: job.id,
      leaseId,
      epoch: job.leaseEpoch,
      exit
    })

    yield* Effect.logInfo(
      `job ${job.id} ${result.status}${result.accepted ? "" : " (not accepted)"}`,
      { exit: exit.tag, message: result.message ?? undefined }
    )
  }).pipe(
    Effect.catchTag("HarnessGatewayError", (error) =>
      Effect.logError(`job ${job.id}: completion was not delivered: ${error.message}`)
    )
  )

const leaseOnce = (config: HarnessConfig, runOptions: RunJobOptions) =>
  Effect.gen(function*() {
    const gateway = yield* HarnessGateway
    const { job } = yield* gateway.leaseNext({
      harnessId: config.harnessId,
      token: config.token,
      kinds: config.kinds,
      accounts: config.accounts,
      waitSeconds: config.waitSeconds
    })

    if (job === null) {
      yield* Effect.logDebug("no job leased")
      return
    }

    yield* Effect.logInfo(`leased ${job.kind} job ${job.id}`, {
      stage: job.stage,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      epoch: job.leaseEpoch
    })

    const outcome = yield* runJob(config, job, runOptions)
    switch (outcome._tag) {
      case "complete":
        yield* deliver(config, job, outcome.exit)
        break
      case "lease_lost":
        yield* Effect.logWarning(`job ${job.id}: ${outcome.reason}`)
        break
      case "skip":
        yield* Effect.logWarning(`job ${job.id}: skipped: ${outcome.reason}`)
        break
    }
  })

/**
 * Long-poll for work until stopped. `config.once` reads exactly one lease per
 * invocation (including an empty answer), which keeps tests and one-shot cron
 * jobs simple.
 */
export const runHarness = Effect.fn("Harness.runHarness")(function*(
  config: HarnessConfig,
  runOptions: RunJobOptions = {}
): Effect.fn.Return<void, never, HarnessGateway> {
  yield* Effect.logInfo(`harness ${config.harnessId} started`, {
    apiUrl: config.apiUrl,
    kinds: config.kinds,
    accounts: config.accounts,
    waitSeconds: config.waitSeconds,
    once: config.once
  })

  while (true) {
    const result = yield* leaseOnce(config, runOptions).pipe(Effect.result)

    if (result._tag === "Failure") {
      yield* Effect.logError(`lease loop: ${result.failure.message}`)
      if (config.once) return
      yield* Effect.sleep(RETRY_DELAY)
    }

    if (config.once) return
  }
})
