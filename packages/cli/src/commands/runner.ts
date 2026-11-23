import type { RunnerId, RunnerJobId, HhAccountId, JobKind, LeaseId } from "@otbor/contract"
import { RunnerExitTag, JobKind as JobKindSchema } from "@otbor/contract"
import {
  RunnerGateway,
  PlaywrightBrowserDriver,
  rpcSessionStore,
  openAiStorePath,
  parseRunnerConfig,
  readOpenAiStore,
  removeOpenAiEndpoint,
  runRunner,
  telemetryLayer,
  upsertOpenAiEndpoint
} from "@otbor/runner"
import { Config, Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { readRunnerState, writeRunnerState } from "../runner-state.ts"

/**
 * Пустой список типов в сохранённой регистрации означает «все», как и при
 * выводе `otbor runner register`. Без этого парсер счел бы пустую строку
 * не заданной и оставил бы только inference.
 */
export const resolveRunnerKinds = (
  flags: ReadonlyArray<JobKind>,
  saved: ReadonlyArray<JobKind> | undefined
): ReadonlyArray<JobKind> => {
  const resolved = flags.length > 0 ? flags : (saved ?? [])
  return resolved.length > 0 ? resolved : JobKindSchema.literals
}

const kindFlag = Flag.Literals("kind", JobKindSchema.literals).pipe(
  Flag.withDescription("Job kind the runner handles (repeatable, default: all)"),
  Flag.between(0, 2)
)

const accountFlag = Flag.String("account").pipe(
  Flag.withDescription("hh account the runner may work for (repeatable)"),
  Flag.between(0, 10)
)

/** `--token` first, `OTBOR_RUNNER_TOKEN` as the fallback for a long-lived device. */
const tokenFlag = Flag.String("token").pipe(
  Flag.withDescription("Device token from register (or set OTBOR_RUNNER_TOKEN)"),
  Flag.withFallbackConfig(Config.String("OTBOR_RUNNER_TOKEN"))
)

const register = Command.make(
  "register",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Stable runner name")),
    kinds: kindFlag,
    accounts: accountFlag,
    save: Flag.Boolean("save").pipe(
      Flag.withDescription("Save the runner id and token in ~/.otbor/runner.json"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ name, kinds, accounts, save }) {
    const api = yield* Api
    const registration = yield* api.RunnerRegister({
      name,
      kinds: kinds as ReadonlyArray<JobKind>,
      accounts: accounts as ReadonlyArray<HhAccountId>
    })
    yield* Console.log(`${registration.id}  ${registration.name}`)
    yield* Console.log(`kinds:    ${registration.kinds.join(", ") || "all"}`)
    yield* Console.log(`accounts: ${registration.accounts.join(", ") || "all"}`)
    yield* Console.log(`token:    ${registration.token ?? "-"}`)
    yield* Console.log(
      "Store this token now: it is shown once and cannot be recovered. Re-register to rotate it."
    )

    if (save && registration.token !== null) {
      const path = writeRunnerState({
        id: registration.id,
        name: registration.name,
        token: registration.token,
        apiUrl: process.env.OTBOR_API_URL,
        kinds: registration.kinds,
        accounts: registration.accounts
      })
      yield* Console.log(`saved:    ${path}`)
    }
  })
).pipe(Command.withDescription("Register this machine's runner"))

const run = Command.make(
  "run",
  {
    runner: Flag.String("runner").pipe(
      Flag.withDescription("Runner id (or use the saved registration)"),
      Flag.optional
    ),
    token: Flag.String("token").pipe(
      Flag.withDescription("Device token (or use the saved registration / OTBOR_RUNNER_TOKEN)"),
      Flag.optional
    ),
    apiUrl: Flag.String("api-url").pipe(
      Flag.withDescription("Cloud RPC URL"),
      Flag.optional
    ),
    kinds: kindFlag,
    accounts: accountFlag,
    wait: Flag.Int("wait").pipe(
      Flag.withDescription("Lease long-poll, 0–30 seconds"),
      Flag.optional
    ),
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDescription("Jobs run at the same time, 1–12 (default 6, or OTBOR_RUNNER_CONCURRENCY)"),
      Flag.optional
    ),
    once: Flag.Boolean("once").pipe(
      Flag.withDescription("Read one lease and exit"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ runner, token, apiUrl, kinds, accounts, wait, concurrency, once }) {
    const saved = readRunnerState()
    const runnerId = Option.getOrElse(
      runner,
      () => saved?.id ?? process.env.OTBOR_RUNNER_ID ?? ""
    )
    const deviceToken = Option.getOrElse(
      token,
      () => saved?.token ?? process.env.OTBOR_RUNNER_TOKEN ?? ""
    )
    const url = Option.getOrElse(
      apiUrl,
      () => saved?.apiUrl ?? process.env.OTBOR_API_URL ?? "http://127.0.0.1:3001/rpc"
    )
    const accountIds = accounts.length > 0 ? accounts : (saved?.accounts ?? [])
    const waitSeconds = Option.getOrElse(
      wait,
      () => Number(process.env.OTBOR_RUNNER_WAIT_SECONDS ?? 30)
    )

    if (runnerId === "" || deviceToken === "") {
      return yield* Effect.fail(
        new Error(
          "Runner id and token are required. Run `otbor runner register --save ...` first, " +
            "or pass --runner/--token."
        )
      )
    }

    const config = yield* parseRunnerConfig({
      OTBOR_API_URL: url,
      OTBOR_RUNNER_ID: runnerId,
      OTBOR_RUNNER_TOKEN: deviceToken,
      OTBOR_RUNNER_KINDS: resolveRunnerKinds(
        kinds as ReadonlyArray<JobKind>,
        saved?.kinds as ReadonlyArray<JobKind> | undefined
      ).join(","),
      OTBOR_RUNNER_ACCOUNTS: accountIds.join(","),
      OTBOR_RUNNER_WAIT_SECONDS: String(waitSeconds),
      ...(Option.isSome(concurrency)
        ? { OTBOR_RUNNER_CONCURRENCY: String(concurrency.value) }
        : process.env.OTBOR_RUNNER_CONCURRENCY === undefined
          ? {}
          : { OTBOR_RUNNER_CONCURRENCY: process.env.OTBOR_RUNNER_CONCURRENCY })
    })

    // Browser jobs take the account's hh cookies from the cloud (`otbor hh login`
    // stores them there); nothing here talks to hh.ru unless a browser job is leased.
    const handlesBrowser = config.kinds.length === 0 || config.kinds.includes("browser")
    yield* runRunner(
      { ...config, once },
      handlesBrowser
        ? {
            driverLayer: PlaywrightBrowserDriver.layer({
              sessions: rpcSessionStore({ url: config.apiUrl, runnerId: config.runnerId, token: config.token }),
              headless: process.env.OTBOR_BROWSER_HEADLESS !== "0",
              ...(Number.isInteger(Number(process.env.OTBOR_RUNNER_ACCOUNT_SUBMIT_CONCURRENCY)) &&
                Number(process.env.OTBOR_RUNNER_ACCOUNT_SUBMIT_CONCURRENCY) >= 1
                ? { accountActingConcurrency: Number(process.env.OTBOR_RUNNER_ACCOUNT_SUBMIT_CONCURRENCY) }
                : {}),
              ...(process.env.OTBOR_CHROME_PATH === undefined
                ? {}
                : { executablePath: process.env.OTBOR_CHROME_PATH })
            })
          }
        : {}
    ).pipe(
      Effect.provide(RunnerGateway.layer(config.apiUrl)),
      // Логи, трейсы и метрики раннера идут в OTLP, если заданы `OTEL_*`:
      // тогда в Tempo видно задачи и попытки решить капчу, а в Loki — те же
      // строки, что печатаются в терминал и `logs/runner.log`.
      Effect.provide(telemetryLayer("otbor-runner"))
    )
  })
).pipe(Command.withDescription("Run the local runner loop"))

const lease = Command.make(
  "lease",
  {
    runner: Flag.String("runner").pipe(Flag.withDescription("Runner id from register")),
    token: tokenFlag,
    kinds: kindFlag,
    accounts: accountFlag,
    wait: Flag.Int("wait").pipe(
      Flag.withDescription("Long-poll for up to this many seconds (max 30)"),
      Flag.withDefault(0)
    )
  },
  Effect.fn(function*({ runner, token, kinds, accounts, wait }) {
    const api = yield* Api
    const { job } = yield* api.RunnerLeaseNext({
      runnerId: runner as RunnerId,
      token,
      kinds: kinds as ReadonlyArray<JobKind>,
      accounts: accounts as ReadonlyArray<HhAccountId>,
      waitSeconds: wait
    })

    if (job === null) {
      yield* Console.log("no job")
      return
    }

    yield* Console.log(`job:    ${job.id}`)
    yield* Console.log(`kind:   ${job.kind}  stage: ${job.stage}  attempts: ${job.attempts}/${job.maxAttempts}`)
    yield* Console.log(`lease:  ${job.leaseId}  epoch: ${job.leaseEpoch}`)
    yield* Console.log(`until:  ${job.leaseUntil ?? "-"}`)
    yield* Console.log(JSON.stringify(job.payload, null, 2))
  })
).pipe(Command.withDescription("Lease the next job, optionally long-polling"))

const heartbeat = Command.make(
  "heartbeat",
  {
    runner: Flag.String("runner"),
    token: tokenFlag,
    job: Flag.String("job"),
    lease: Flag.String("lease"),
    epoch: Flag.Int("epoch")
  },
  Effect.fn(function*({ runner, token, job, lease, epoch }) {
    const api = yield* Api
    const result = yield* api.RunnerHeartbeat({
      runnerId: runner as RunnerId,
      token,
      jobId: job as RunnerJobId,
      leaseId: lease as LeaseId,
      epoch
    })
    yield* Console.log(result.ok ? "ok" : `stopped: ${result.reason ?? "lease lost"}`)
  })
).pipe(Command.withDescription("Extend a lease; a false answer means stop working"))

const complete = Command.make(
  "complete",
  {
    runner: Flag.String("runner"),
    token: tokenFlag,
    job: Flag.String("job"),
    lease: Flag.String("lease"),
    epoch: Flag.Int("epoch"),
    exit: Flag.Literals("exit", RunnerExitTag.literals).pipe(
      Flag.withDescription("What the attempt actually did")
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Human-readable detail"),
      Flag.optional
    ),
    formHash: Flag.String("form-hash").pipe(
      Flag.withDescription("Hash of the form the driver saw"),
      Flag.optional
    ),
    retryAfter: Flag.Int("retry-after").pipe(
      Flag.withDescription("Seconds before a retry is allowed"),
      Flag.optional
    )
  },
  Effect.fn(function*({ runner, token, job, lease, epoch, exit, message, formHash, retryAfter }) {
    const api = yield* Api
    const result = yield* api.RunnerComplete({
      runnerId: runner as RunnerId,
      token,
      jobId: job as RunnerJobId,
      leaseId: lease as LeaseId,
      epoch,
      exit: {
        tag: exit,
        message: Option.getOrUndefined(message),
        formHash: Option.getOrUndefined(formHash),
        retryAfterSeconds: Option.getOrUndefined(retryAfter)
      }
    })
    yield* Console.log(`${result.status}${result.accepted ? "" : " (not accepted)"}`)
    if (result.message !== null && result.message !== undefined) {
      yield* Console.log(result.message)
    }
  })
).pipe(Command.withDescription("Report the outcome of a leased job"))

const revoke = Command.make(
  "revoke",
  {
    runner: Flag.String("runner").pipe(Flag.withDescription("Runner id to revoke"))
  },
  Effect.fn(function*({ runner }) {
    const api = yield* Api
    const result = yield* api.RunnerRevoke({ runnerId: runner as RunnerId })
    yield* Console.log(
      result.revoked
        ? `revoked ${result.runnerId}; the device can no longer lease work`
        : `no runner ${result.runnerId} for the current user`
    )
  })
).pipe(Command.withDescription("Clear a runner token so its device cannot continue"))

const modelAdd = Command.make(
  "add",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Harness id in the catalog and in job payloads (e.g. omlx)")
    ),
    url: Flag.String("url").pipe(
      Flag.withDescription("OpenAI API root with /v1, e.g. http://127.0.0.1:8000/v1")
    ),
    name: Flag.String("name").pipe(Flag.optional),
    apiKey: Flag.String("api-key").pipe(
      Flag.withDescription("API key, stored in ~/.otbor/openai.json (0600)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ id, url, name, apiKey }) {
    const path = upsertOpenAiEndpoint({
      id,
      url,
      ...(Option.isSome(name) ? { name: name.value } : {}),
      ...(Option.isSome(apiKey) ? { apiKey: apiKey.value } : {})
    })
    yield* Console.log(`saved ${id}: ${path}`)
  })
).pipe(Command.withDescription("Add or replace a local OpenAI-compatible model server"))

const modelList = Command.make(
  "list",
  {},
  Effect.fn(function*() {
    const endpoints = readOpenAiStore()
    yield* Console.log(`${openAiStorePath()}`)
    for (const endpoint of endpoints) {
      yield* Console.log(
        `${endpoint.id}  ${endpoint.url}  ${endpoint.apiKey === undefined ? "no key" : "key set"}`
      )
    }
    if (endpoints.length === 0) yield* Console.log("(none)")
  })
).pipe(Command.withDescription("List saved local model servers"))

const modelRemove = Command.make(
  "remove",
  { id: Flag.String("id") },
  Effect.fn(function*({ id }) {
    yield* Console.log(removeOpenAiEndpoint(id) ? `removed ${id}` : `no such server: ${id}`)
  })
).pipe(Command.withDescription("Remove a saved local model server"))

const model = Command.make("model").pipe(
  Command.withSubcommands([modelAdd, modelList, modelRemove]),
  Command.withDescription("Local models over the OpenAI API (oMLX, LM Studio, llama.cpp)")
)

export const runnerCommand = Command.make("runner").pipe(
  Command.withSubcommands([register, run, model, lease, heartbeat, complete, revoke]),
  Command.withDescription("The runner protocol")
)
