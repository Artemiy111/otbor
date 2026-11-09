import type { HarnessId, HarnessJobId, HhAccountId, JobKind, LeaseId } from "@otbor/contract"
import { HarnessExitTag, JobKind as JobKindSchema } from "@otbor/contract"
import {
  HarnessGateway,
  PlaywrightBrowserExecutor,
  openAiStorePath,
  parseHarnessConfig,
  readOpenAiStore,
  removeOpenAiEndpoint,
  runHarness,
  upsertOpenAiEndpoint
} from "@otbor/harness"
import { Config, Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { readHarnessState, writeHarnessState } from "../harness-state.ts"

const kindFlag = Flag.Literals("kind", JobKindSchema.literals).pipe(
  Flag.withDescription("Job kind the harness handles (repeatable, default: all)"),
  Flag.between(0, 2)
)

const accountFlag = Flag.String("account").pipe(
  Flag.withDescription("hh account the harness may work for (repeatable)"),
  Flag.between(0, 10)
)

/** `--token` first, `OTBOR_HARNESS_TOKEN` as the fallback for a long-lived device. */
const tokenFlag = Flag.String("token").pipe(
  Flag.withDescription("Device token from register (or set OTBOR_HARNESS_TOKEN)"),
  Flag.withFallbackConfig(Config.String("OTBOR_HARNESS_TOKEN"))
)

const register = Command.make(
  "register",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Stable harness name")),
    kinds: kindFlag,
    accounts: accountFlag,
    save: Flag.Boolean("save").pipe(
      Flag.withDescription("Save the harness id and token in ~/.otbor/harness.json"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ name, kinds, accounts, save }) {
    const api = yield* Api
    const registration = yield* api.HarnessRegister({
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
      const path = writeHarnessState({
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
).pipe(Command.withDescription("Register this machine's harness"))

const run = Command.make(
  "run",
  {
    harness: Flag.String("harness").pipe(
      Flag.withDescription("Harness id (or use the saved registration)"),
      Flag.optional
    ),
    token: Flag.String("token").pipe(
      Flag.withDescription("Device token (or use the saved registration / OTBOR_HARNESS_TOKEN)"),
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
      Flag.withDescription("Jobs run at the same time, 1–12 (default 6, or OTBOR_HARNESS_CONCURRENCY)"),
      Flag.optional
    ),
    once: Flag.Boolean("once").pipe(
      Flag.withDescription("Read one lease and exit"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ harness, token, apiUrl, kinds, accounts, wait, concurrency, once }) {
    const saved = readHarnessState()
    const harnessId = Option.getOrElse(
      harness,
      () => saved?.id ?? process.env.OTBOR_HARNESS_ID ?? ""
    )
    const deviceToken = Option.getOrElse(
      token,
      () => saved?.token ?? process.env.OTBOR_HARNESS_TOKEN ?? ""
    )
    const url = Option.getOrElse(
      apiUrl,
      () => saved?.apiUrl ?? process.env.OTBOR_API_URL ?? "http://127.0.0.1:3001/rpc"
    )
    const accountIds = accounts.length > 0 ? accounts : (saved?.accounts ?? [])
    const waitSeconds = Option.getOrElse(
      wait,
      () => Number(process.env.OTBOR_HARNESS_WAIT_SECONDS ?? 30)
    )

    if (harnessId === "" || deviceToken === "") {
      return yield* Effect.fail(
        new Error(
          "Harness id and token are required. Run `otbor harness register --save ...` first, " +
            "or pass --harness/--token."
        )
      )
    }

    const config = yield* parseHarnessConfig({
      OTBOR_API_URL: url,
      OTBOR_HARNESS_ID: harnessId,
      OTBOR_HARNESS_TOKEN: deviceToken,
      OTBOR_HARNESS_KINDS: (kinds.length > 0 ? kinds : (saved?.kinds ?? [])).join(","),
      OTBOR_HARNESS_ACCOUNTS: accountIds.join(","),
      OTBOR_HARNESS_WAIT_SECONDS: String(waitSeconds),
      ...(Option.isSome(concurrency)
        ? { OTBOR_HARNESS_CONCURRENCY: String(concurrency.value) }
        : process.env.OTBOR_HARNESS_CONCURRENCY === undefined
          ? {}
          : { OTBOR_HARNESS_CONCURRENCY: process.env.OTBOR_HARNESS_CONCURRENCY })
    })

    // Browser jobs need the account's hh session on this machine. The profile
    // is the one `otbor hh login` wrote; nothing here talks to hh.ru unless a
    // browser job is actually leased.
    const handlesBrowser = config.kinds.length === 0 || config.kinds.includes("browser")
    yield* runHarness(
      { ...config, once },
      handlesBrowser
        ? {
            browserLayer: PlaywrightBrowserExecutor.layer({
              headless: process.env.OTBOR_BROWSER_HEADLESS !== "0",
              ...(Number.isInteger(Number(process.env.OTBOR_HARNESS_ACCOUNT_SUBMIT_CONCURRENCY)) &&
                Number(process.env.OTBOR_HARNESS_ACCOUNT_SUBMIT_CONCURRENCY) >= 1
                ? { accountActingConcurrency: Number(process.env.OTBOR_HARNESS_ACCOUNT_SUBMIT_CONCURRENCY) }
                : {}),
              ...(process.env.OTBOR_CHROME_PATH === undefined
                ? {}
                : { executablePath: process.env.OTBOR_CHROME_PATH })
            })
          }
        : {}
    ).pipe(
      Effect.provide(HarnessGateway.layer(config.apiUrl))
    )
  })
).pipe(Command.withDescription("Run the local edge harness loop"))

const lease = Command.make(
  "lease",
  {
    harness: Flag.String("harness").pipe(Flag.withDescription("Harness id from register")),
    token: tokenFlag,
    kinds: kindFlag,
    accounts: accountFlag,
    wait: Flag.Int("wait").pipe(
      Flag.withDescription("Long-poll for up to this many seconds (max 30)"),
      Flag.withDefault(0)
    )
  },
  Effect.fn(function*({ harness, token, kinds, accounts, wait }) {
    const api = yield* Api
    const { job } = yield* api.HarnessLeaseNext({
      harnessId: harness as HarnessId,
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
    harness: Flag.String("harness"),
    token: tokenFlag,
    job: Flag.String("job"),
    lease: Flag.String("lease"),
    epoch: Flag.Int("epoch")
  },
  Effect.fn(function*({ harness, token, job, lease, epoch }) {
    const api = yield* Api
    const result = yield* api.HarnessHeartbeat({
      harnessId: harness as HarnessId,
      token,
      jobId: job as HarnessJobId,
      leaseId: lease as LeaseId,
      epoch
    })
    yield* Console.log(result.ok ? "ok" : `stopped: ${result.reason ?? "lease lost"}`)
  })
).pipe(Command.withDescription("Extend a lease; a false answer means stop working"))

const complete = Command.make(
  "complete",
  {
    harness: Flag.String("harness"),
    token: tokenFlag,
    job: Flag.String("job"),
    lease: Flag.String("lease"),
    epoch: Flag.Int("epoch"),
    exit: Flag.Literals("exit", HarnessExitTag.literals).pipe(
      Flag.withDescription("What the attempt actually did")
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Human-readable detail"),
      Flag.optional
    ),
    formHash: Flag.String("form-hash").pipe(
      Flag.withDescription("Hash of the form the harness saw"),
      Flag.optional
    ),
    retryAfter: Flag.Int("retry-after").pipe(
      Flag.withDescription("Seconds before a retry is allowed"),
      Flag.optional
    )
  },
  Effect.fn(function*({ harness, token, job, lease, epoch, exit, message, formHash, retryAfter }) {
    const api = yield* Api
    const result = yield* api.HarnessComplete({
      harnessId: harness as HarnessId,
      token,
      jobId: job as HarnessJobId,
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
    harness: Flag.String("harness").pipe(Flag.withDescription("Harness id to revoke"))
  },
  Effect.fn(function*({ harness }) {
    const api = yield* Api
    const result = yield* api.HarnessRevoke({ harnessId: harness as HarnessId })
    yield* Console.log(
      result.revoked
        ? `revoked ${result.harnessId}; the device can no longer lease work`
        : `no harness ${result.harnessId} for the current user`
    )
  })
).pipe(Command.withDescription("Clear a harness token so its device cannot continue"))

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

export const harnessCommand = Command.make("harness").pipe(
  Command.withSubcommands([register, run, model, lease, heartbeat, complete, revoke]),
  Command.withDescription("The edge harness protocol")
)
