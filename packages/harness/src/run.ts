import { AcpClient } from "@otbor/acp"
import {
  type AgentHarness,
  type HarnessExit,
  type HarnessJob,
  type LeaseId,
  FormReadJobPayload,
  LetterAttachJobPayload,
  PrepareJobPayload,
  NegotiationsSyncJobPayload,
  ChatReadJobPayload,
  ResumeBumpJobPayload,
  ResumeSyncJobPayload,
  ReconcileJobPayload,
  SubmitJobPayload
} from "@otbor/contract"
import { Cause, Deferred, Duration, Effect, Fiber, type Layer, Option, Ref, Schema } from "effect"
import { BrowserExecutor } from "./browser/executor.ts"
import { HarnessGateway } from "./client.ts"
import { MAX_CONCURRENCY, type HarnessConfig } from "./config.ts"
import { probeCatalog } from "./catalog.ts"
import { payloadHarness, runInferenceExit } from "./inference.ts"

/** The cloud lease is 120s; a third of it keeps a slow prompt alive. */
export const HEARTBEAT_INTERVAL = Duration.seconds(30)
const RETRY_DELAY = Duration.seconds(5)
/** Как часто простаивающий цикл проверяет, не увеличилось ли число потоков. */
const IDLE_POLL = Duration.seconds(1)
/** How often the catalog of agents, models and efforts is probed and reported. */
export const CATALOG_REPORT_INTERVAL = Duration.minutes(30)

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
 * Test seam: production starts the agent named by the job payload
 * (`AcpClient.layerFor`, one agent process per job),
 * while unit tests inject a fake ACP layer and a short heartbeat interval.
 */
export interface RunJobOptions {
  readonly heartbeatEvery?: Duration.Input
  readonly acpLayer?: Layer.Layer<AcpClient>
  /** What `runHarness` reports as the catalog; default: probe the real agents. */
  readonly probe?: Effect.Effect<ReadonlyArray<AgentHarness>>
  readonly catalogEvery?: Duration.Input
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
    case "form_read":
      // Same page, same reading as `prepare`; the job just has no application.
      return Schema.decodeUnknownEffect(FormReadJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(badPayload("form_read", error.message)),
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
    case "letter_attach":
      return Schema.decodeUnknownEffect(LetterAttachJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // Nothing was clicked, so a bad payload sent nothing.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid letter_attach payload: ${error.message}`,
              artifacts: { clicked: false, closed: false, url: "" }
            }),
          onSuccess: (payload) =>
            executor.attachLetter({
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
    case "negotiations_sync":
      return Schema.decodeUnknownEffect(NegotiationsSyncJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // Read-only, so a bad payload touched nothing.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid negotiations_sync payload: ${error.message}`
            }),
          onSuccess: (payload) => executor.negotiationsSync(payload)
        })
      )
    case "resume_sync":
      return Schema.decodeUnknownEffect(ResumeSyncJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // Read-only, so a bad payload touched nothing.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid resume_sync payload: ${error.message}`
            }),
          onSuccess: (payload) => executor.resumeSync(payload)
        })
      )
    case "chat_read":
      return Schema.decodeUnknownEffect(ChatReadJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // Read-only, so a bad payload touched nothing.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid chat_read payload: ${error.message}`
            }),
          onSuccess: (payload) => executor.chatRead(payload)
        })
      )
    case "resume_bump":
      return Schema.decodeUnknownEffect(ResumeBumpJobPayload)(job.payload).pipe(
        Effect.matchEffect({
          // Нажатия не было, так что плохая нагрузка ничего не подняла.
          onFailure: (error) =>
            Effect.succeed<HarnessExit>({
              tag: "permanent",
              message: `invalid resume_bump payload: ${error.message}`
            }),
          onSuccess: (payload) =>
            executor.resumeBump({
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
        Effect.provide(
          options.acpLayer ?? AcpClient.layerFor(payloadHarness(job.payload))
        ),
        // The agent could not start (unknown id, not installed, not logged in)
        // or the environment is misconfigured: say why, never fall back.
        Effect.catch((error) =>
          Effect.succeed<HarnessExit>({
            tag: "inference_failed",
            message: error._tag === "ConfigError"
              ? `ACP configuration error: ${error.message}`
              : error.message
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

/**
 * Сколько потоков харнесс держит сейчас. Начальное значение - из конфигурации
 * (`OTBOR_HARNESS_CONCURRENCY`), его же харнесс остаётся держать, пока облако
 * не скажет иное: каждый ответ на `HarnessLeaseNext` может принести
 * `harnessSlots` из настроек пользователя.
 */
const clampSlots = (value: number): number =>
  Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)))

const leaseOnce = (config: HarnessConfig, runOptions: RunJobOptions, slots: Ref.Ref<number>) =>
  Effect.gen(function*() {
    const gateway = yield* HarnessGateway
    const { job, harnessSlots } = yield* gateway.leaseNext({
      harnessId: config.harnessId,
      token: config.token,
      kinds: config.kinds,
      accounts: config.accounts,
      waitSeconds: config.waitSeconds,
      concurrency: config.once ? 1 : yield* Ref.get(slots)
    })

    // Облако - главный по числу потоков: подстраиваем пул на лету.
    if (harnessSlots !== undefined && !config.once) {
      const next = clampSlots(harnessSlots)
      const previous = yield* Ref.getAndSet(slots, next)
      if (previous !== next) yield* Effect.logInfo(`harness slots ${previous} -> ${next} (from the cloud settings)`)
    }

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
 * Probe the agents and tell the cloud what this harness can run. Failures are
 * logged and swallowed: a missing catalog must never stop job processing.
 */
export const reportCatalogOnce = (config: HarnessConfig, options: RunJobOptions = {}) =>
  Effect.gen(function*() {
    const gateway = yield* HarnessGateway
    const harnesses = yield* options.probe ?? probeCatalog()
    yield* gateway.reportCatalog({
      harnessId: config.harnessId,
      token: config.token,
      harnesses
    })
    yield* Effect.logInfo("reported agent catalog", {
      agents: harnesses.map((agent) => ({
        id: agent.id,
        available: agent.available,
        models: agent.models.length
      }))
    })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent catalog was not reported", Cause.squash(cause))
    )
  )

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
    concurrency: config.once ? 1 : clampSlots(config.concurrency),
    once: config.once
  })

  // Inference harnesses publish what they can run: once now, then every 30
  // minutes, in the background so a slow `claude` start never delays a lease.
  if (config.kinds.includes("inference") && !config.once) {
    yield* Effect.forkChild(
      reportCatalogOnce(config, runOptions).pipe(
        Effect.andThen(Effect.sleep(runOptions.catalogEvery ?? CATALOG_REPORT_INTERVAL)),
        Effect.forever
      )
    )
  }

  const slots = yield* Ref.make(clampSlots(config.concurrency))

  /**
   * Один цикл выдачи. Номер `index` решает, работает ли он при текущем числе
   * потоков: циклы сверх него простаивают (доделав начатую задачу) и просыпаются,
   * когда облако увеличит число потоков. Пул уменьшается и растёт на лету.
   */
  const worker = (index: number) =>
    Effect.gen(function*() {
      while (true) {
        if (!config.once && index >= (yield* Ref.get(slots))) {
          yield* Effect.sleep(IDLE_POLL)
          continue
        }

        const result = yield* leaseOnce(config, runOptions, slots).pipe(Effect.result)

        if (result._tag === "Failure") {
          yield* Effect.logError(`lease loop: ${result.failure.message}`)
          if (config.once) return
          yield* Effect.sleep(RETRY_DELAY)
        }

        if (config.once) return
      }
    })

  if (config.once) return yield* worker(0)

  // Циклов столько, сколько харнесс вообще может держать; сколько из них
  // выдаёт задачи, решает `slots`. Медленное письмо или чтение формы не держит
  // остальную очередь, а облако выдаёт каждую задачу одному циклу.
  yield* Effect.forEach(
    Array.from({ length: MAX_CONCURRENCY }, (_, index) => index),
    (index) => worker(index),
    { concurrency: "unbounded", discard: true }
  )
})
