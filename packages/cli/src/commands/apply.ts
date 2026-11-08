import { type Answer, type ApplicationId, type HhAccountId, describeKitAnswer } from "@otbor/contract"
import { Console, Effect, FileSystem, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { formatApplication, shortId, table } from "../format.ts"
import { resolveApplicationId, resolveDecisionId } from "../resolve.ts"
import { resolveAccount } from "./filter.ts"

const accountFlag = Flag.String("account").pipe(
  Flag.withDescription("hh account id (defaults to OTBOR_HH_ACCOUNT_ID)"),
  Flag.optional
)

const requireAccount = (account: Option.Option<string>): Effect.Effect<HhAccountId, Error> =>
  Effect.gen(function*() {
    const value = Option.getOrElse(account, () => process.env.OTBOR_HH_ACCOUNT_ID ?? "")
    if (value.length === 0) {
      return yield* Effect.fail(
        new Error("Pass --account or set OTBOR_HH_ACCOUNT_ID")
      )
    }
    return value as HhAccountId
  })

const idArgument = Argument.String("id").pipe(Argument.withDescription("Application id or prefix"))

const create = Command.make(
  "create",
  {
    decision: Flag.String("decision").pipe(Flag.withDescription("Decision id")),
    account: accountFlag,
    resume: Flag.String("resume").pipe(Flag.withDescription("Resume id"), Flag.optional),
    auto: Flag.Boolean("auto").pipe(
      Flag.withDescription("Queue the application after prepare instead of waiting for approval"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ decision, account, resume, auto }) {
    const api = yield* Api
    const hhAccountId = yield* requireAccount(account)
    const decisionId = yield* resolveDecisionId(api, decision)
    const application = yield* api.ApplicationsCreateFromDecision({
      decisionId,
      hhAccountId,
      resumeId: Option.getOrUndefined(resume),
      mode: auto ? "auto" : "drafts"
    })
    yield* Console.log(
      `${application.id}  ${application.state}  ${application.vacancyTitle ?? application.vacancyId}`
    )
  })
).pipe(Command.withDescription("Create an application from an apply/draft decision"))

const list = Command.make(
  "list",
  {
    state: Flag.String("state").pipe(
      Flag.withDescription("Filter by state (draft, preparing, queued, submitting, submitted, ...)"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ state, limit, json }) {
    const api = yield* Api
    const applications = yield* api.ApplicationsList({
      state: Option.getOrUndefined(state),
      limit
    })

    if (json) {
      yield* Console.log(JSON.stringify(applications, null, 2))
      return
    }
    if (applications.length === 0) {
      yield* Console.log("No applications.")
      return
    }

    yield* Console.log(
      table(["id", "state", "vacancy", "employer", "updated"], applications.map(formatApplication))
    )
  })
).pipe(Command.withDescription("List applications"))

const get = Command.make(
  "get",
  { id: idArgument },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const detail = yield* api.ApplicationsGet({ id: applicationId })

    yield* Console.log(`${detail.application.vacancyTitle ?? detail.application.vacancyId}`)
    yield* Console.log(`id:       ${detail.application.id}`)
    yield* Console.log(`state:    ${detail.application.state}`)
    if (detail.application.blockedReason != null) {
      const retry = detail.application.retryAt == null ? "" : `  (retry at ${detail.application.retryAt})`
      yield* Console.log(`blocked:  ${detail.application.blockedReason}${retry}`)
    }
    yield* Console.log(`employer: ${detail.application.employerName ?? "-"}`)
    yield* Console.log(`account:  ${detail.application.hhAccountId}`)
    yield* Console.log(`resume:   ${detail.application.resumeId ?? "-"}`)
    yield* Console.log(`updated:  ${detail.application.updatedAt}`)

    if (detail.kit !== null && detail.kit !== undefined) {
      yield* Console.log(`\nkit ${shortId(detail.kit.id)} form=${detail.kit.formHash}`)
      if (detail.kit.letter !== null && detail.kit.letter !== undefined) {
        yield* Console.log(detail.kit.letter)
      }
      for (const raw of detail.kit.answers) {
        const answer = describeKitAnswer(raw, detail.form?.form)
        yield* Console.log(`Q: ${answer.question}\nA: ${answer.answer}`)
      }
    }

    if (detail.attempts.length > 0) {
      yield* Console.log("")
      yield* Console.log(
        table(
          ["seq", "stage", "exit", "started", "finished"],
          detail.attempts.map((attempt) => [
            `${attempt.seq}`,
            attempt.stage,
            attempt.exit?.tag ?? "-",
            attempt.startedAt.slice(0, 19).replace("T", " "),
            attempt.finishedAt?.slice(0, 19).replace("T", " ") ?? "-"
          ])
        )
      )
    }
  })
).pipe(Command.withDescription("Show one application with its kit and attempts"))

const approve = Command.make(
  "approve",
  { id: idArgument },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const application = yield* api.ApplicationsApprove({ id: applicationId })
    yield* Console.log(`${application.id}  ${application.state}`)
  })
).pipe(Command.withDescription("Approve a prepared draft and queue the submit job"))

const skip = Command.make(
  "skip",
  {
    id: idArgument,
    reason: Flag.String("reason").pipe(Flag.optional)
  },
  Effect.fn(function*({ id, reason }) {
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const application = yield* api.ApplicationsSkip({
      id: applicationId,
      reason: Option.getOrUndefined(reason)
    })
    yield* Console.log(`${application.id}  ${application.state}`)
  })
).pipe(Command.withDescription("Skip an application and cancel its prepared jobs"))

const retry = Command.make(
  "retry",
  { id: idArgument },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const application = yield* api.ApplicationsRetry({ id: applicationId })
    yield* Console.log(`${application.id}  ${application.state}`)
  })
).pipe(
  Command.withDescription(
    "Retry: reconcile first when a submit was attempted, otherwise re-prepare"
  )
)

const kit = Command.make(
  "kit",
  {
    id: idArgument,
    formHash: Flag.String("form-hash").pipe(
      Flag.withDescription("Hash of the form the kit was written for")
    ),
    letter: Flag.String("letter").pipe(
      Flag.withDescription("Cover letter text (@path reads a file)"),
      Flag.optional
    ),
    answers: Flag.String("answer").pipe(
      Flag.withDescription("Answer as question=answer (repeatable)"),
      Flag.between(0, 50)
    ),
    model: Flag.String("model").pipe(Flag.optional),
    promptHash: Flag.String("prompt-hash").pipe(Flag.optional),
    cost: Flag.Finite("cost").pipe(Flag.withDescription("Generation cost in USD"), Flag.optional)
  },
  Effect.fn(function*({ id, formHash, letter, answers, model, promptHash, cost }) {
    const fs = yield* FileSystem.FileSystem
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)

    let letterText: string | null = null
    if (Option.isSome(letter)) {
      const raw = letter.value
      letterText = raw.startsWith("@") ? yield* fs.readFileString(raw.slice(1)) : raw
    }

    const parsed: Array<Answer> = answers.map((pair) => {
      const at = pair.indexOf("=")
      if (at <= 0) {
        throw new Error(`Answer must be question=answer: ${pair}`)
      }
      return { question: pair.slice(0, at), answer: pair.slice(at + 1) }
    })

    const record = yield* api.ApplicationsSetKit({
      applicationId: applicationId as ApplicationId,
      formHash,
      letter: letterText,
      answers: parsed,
      model: Option.getOrUndefined(model),
      promptHash: Option.getOrUndefined(promptHash),
      costUsd: Option.getOrUndefined(cost)
    })

    yield* Console.log(`kit ${record.id}  form=${record.formHash}  answers=${record.answers.length}`)
  })
).pipe(Command.withDescription("Attach the prepared form kit to an application"))

const RUN_COUNTS = ["selected", "created", "writingEnqueued", "kitsSet", "submitQueued", "needsHuman", "waiting"] as const

/** Runs the `apply` schedule once and prints the counts of that run. */
const run = Command.make(
  "run",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account (id, prefix or label). Without it the user-wide apply schedule runs for every account"),
      Flag.optional
    ),
    timeout: Flag.Int("timeout").pipe(Flag.withDescription("Seconds to wait for the result"), Flag.withDefault(120))
  },
  Effect.fn(function*({ account, timeout }) {
    const api = yield* Api
    const target = Option.isSome(account) ? String(yield* resolveAccount(account)) : "global"
    const schedules = yield* api.SchedulesList()
    const matches = (targetId: string) =>
      target === "global" ? targetId === "global" || targetId === "default" || targetId === "" : targetId === target
    let schedule = schedules.find((item) => item.kind === "apply" && matches(item.targetId.trim()))
    if (schedule === undefined) {
      // Created disabled: the worker does not pick it up until the operator enables it.
      schedule = yield* api.ScheduleUpsert({ kind: "apply", targetId: target, intervalMinutes: 15, enabled: false })
      yield* Console.log(`created the apply schedule ${shortId(schedule.id)} (target ${target}, every 15m, disabled)`)
    }
    const startedAt = Date.now() - 2000
    const accepted = yield* api.ScheduleRunNow({ id: schedule.id })
    if (!accepted.accepted) {
      return yield* Effect.fail(new Error("the run was not accepted (is it already running?)"))
    }
    yield* Console.log(`running ${shortId(schedule.id)} ...`)
    const deadline = Date.now() + timeout * 1000
    while (Date.now() < deadline) {
      yield* Effect.sleep("2 seconds")
      const page = yield* api.ScheduleRunsList({ scheduleId: schedule.id, limit: 1 })
      const latest = page.items[0]
      if (latest === undefined || Date.parse(latest.startedAt) < startedAt || latest.status === "running") continue
      if (latest.status === "error") {
        return yield* Effect.fail(new Error(latest.error ?? "the run failed"))
      }
      const detail = (latest.detail ?? {}) as Record<string, unknown>
      yield* Console.log(RUN_COUNTS.map((key) => `${key}=${typeof detail[key] === "number" ? detail[key] : 0}`).join("  "))
      const errors = Array.isArray(detail.errors) ? detail.errors : []
      for (const error of errors) yield* Console.log(`  error: ${String(error)}`)
      return
    }
    yield* Console.log("no result yet; see: otbor schedule list")
  })
).pipe(Command.withDescription("Run the auto-apply schedule once and print the counts (modes off do nothing)"))

export const applyCommand = Command.make("apply").pipe(
  Command.withSubcommands([create, list, get, approve, skip, retry, kit, run]),
  Command.withDescription("Applications: create, review, approve, retry")
)
