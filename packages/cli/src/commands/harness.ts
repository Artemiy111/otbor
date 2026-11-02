import type { HarnessId, HarnessJobId, HhAccountId, JobKind, LeaseId } from "@otbor/contract"
import { HarnessExitTag, JobKind as JobKindSchema } from "@otbor/contract"
import { Config, Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

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
    accounts: accountFlag
  },
  Effect.fn(function*({ name, kinds, accounts }) {
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
  })
).pipe(Command.withDescription("Register this machine's harness"))

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

export const harnessCommand = Command.make("harness").pipe(
  Command.withSubcommands([register, lease, heartbeat, complete, revoke]),
  Command.withDescription("The edge harness protocol")
)
