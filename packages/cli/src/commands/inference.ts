import type { HarnessJob, HarnessJobId, HhAccountId } from "@otbor/contract"
import {
  InferencePayload as InferencePayloadSchema,
  InferenceResult as InferenceResultSchema
} from "@otbor/contract"
import { Console, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

/** The cloud answers `pending`/`leased`/`running` until the job settles. */
const terminal = new Set<string>([
  "done",
  "failed",
  "dead",
  "needs_human",
  "cancelled",
  "needs_reconcile"
])

const resultText = (result: unknown): string | null => {
  if (result === null || result === undefined) return null
  const decoded = Schema.decodeUnknownOption(InferenceResultSchema)(result)
  return Option.isSome(decoded) ? decoded.value.text : JSON.stringify(result, null, 2)
}

const readStdin = Effect.tryPromise({
  try: () => Bun.stdin.text(),
  catch: (cause) =>
    new Error(
      `Unable to read the prompt from stdin: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
})

/**
 * The prompt is an argument, but pipe-friendly too: `cat task.txt | otbor
 * inference run`. On a terminal an empty prompt is a mistake, not a wait.
 */
const resolvePrompt = (argument: Option.Option<string>) =>
  Option.match(argument, {
    onNone: () =>
      process.stdin.isTTY
        ? Effect.fail(new Error("Prompt is required: pass text or pipe it on stdin"))
        : readStdin,
    onSome: (text) => Effect.succeed(text)
  })

const requirePrompt = (text: string) =>
  text.trim() === ""
    ? Effect.fail(new Error("Prompt is empty: pass text or pipe it on stdin"))
    : Effect.succeed(text)

const waitFor = (id: HarnessJobId, timeoutSeconds: number) =>
  Effect.gen(function*() {
    const api = yield* Api
    const deadline = Date.now() + timeoutSeconds * 1_000
    for (;;) {
      const job = yield* api.InferenceGet({ id })
      if (terminal.has(job.status)) return { job, timedOut: false }
      if (Date.now() >= deadline) return { job, timedOut: true }
      yield* Effect.sleep("1 second")
    }
  })

const printSettled = (job: HarnessJob, timedOut: boolean) =>
  Effect.gen(function*() {
    const text = resultText(job.result)

    if (!timedOut && job.status === "done") {
      if (text === null) {
        yield* Console.error("status: done (no result)")
        process.exitCode = 1
        return
      }
      yield* Console.log(text)
      return
    }

    yield* Console.log(`job:    ${job.id}`)
    yield* Console.log(`status: ${job.status}`)
    if (timedOut) {
      yield* Console.log("timed out while waiting; the job is still queued or running")
    }
    if (text !== null) {
      yield* Console.log("")
      yield* Console.log(text)
    }
    process.exitCode = 1
  })

const run = Command.make(
  "run",
  {
    prompt: Argument.String("prompt").pipe(
      Argument.withDescription("Prompt to run (defaults to stdin)"),
      Argument.optional
    ),
    system: Flag.String("system").pipe(
      Flag.withDescription("System instructions sent with the prompt"),
      Flag.optional
    ),
    model: Flag.String("model").pipe(
      Flag.withDescription("Model the harness should use"),
      Flag.optional
    ),
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id to attach to the job"),
      Flag.optional
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Seconds to wait for the result"),
      Flag.withDefault(120)
    ),
    noWait: Flag.Boolean("no-wait").pipe(
      Flag.withDescription("Enqueue and print the job id without polling"),
      Flag.withDefault(false)
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the job as JSON"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ prompt, system, model, account, timeout, noWait, json }) {
    if (timeout <= 0) {
      return yield* Effect.fail(new Error("--timeout must be a positive number of seconds"))
    }

    const text = yield* requirePrompt(yield* resolvePrompt(prompt))
    const api = yield* Api

    const { job } = yield* api.InferenceEnqueue({
      prompt: text,
      ...(Option.isSome(system) ? { system: system.value } : {}),
      ...(Option.isSome(model) ? { model: model.value } : {}),
      ...(Option.isSome(account) ? { hhAccountId: account.value as HhAccountId } : {})
    })

    if (noWait) {
      yield* (json ? Console.log(JSON.stringify(job, null, 2)) : Console.log(job.id))
      return
    }

    const outcome = yield* waitFor(job.id, timeout)
    if (json) {
      yield* Console.log(JSON.stringify(outcome, null, 2))
      if (
        outcome.timedOut ||
        outcome.job.status !== "done" ||
        resultText(outcome.job.result) === null
      ) {
        process.exitCode = 1
      }
      return
    }
    yield* printSettled(outcome.job, outcome.timedOut)
  })
).pipe(Command.withDescription("Enqueue an inference prompt and wait for the answer"))

const get = Command.make(
  "get",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Inference job id")),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the job as JSON"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ id, json }) {
    const api = yield* Api
    const job = yield* api.InferenceGet({ id: id as HarnessJobId })

    if (json) {
      yield* Console.log(JSON.stringify(job, null, 2))
      return
    }

    const payload = Schema.decodeUnknownOption(InferencePayloadSchema)(job.payload)

    yield* Console.log(`id:       ${job.id}`)
    yield* Console.log(`status:   ${job.status}`)
    yield* Console.log(`stage:    ${job.stage}`)
    yield* Console.log(`attempts: ${job.attempts}/${job.maxAttempts}`)
    yield* Console.log(`run at:   ${job.runAt}`)
    if (Option.isSome(payload)) {
      yield* Console.log(`prompt:   ${payload.value.prompt}`)
      if (payload.value.system !== undefined) {
        yield* Console.log(`system:   ${payload.value.system}`)
      }
      if (payload.value.model !== undefined) {
        yield* Console.log(`model:    ${payload.value.model}`)
      }
    } else {
      yield* Console.log(`payload:  ${JSON.stringify(job.payload, null, 2)}`)
    }

    const text = resultText(job.result)
    if (text !== null) {
      yield* Console.log("result:")
      yield* Console.log(text)
    }
  })
).pipe(Command.withDescription("Show one inference job and its result"))

export const inferenceCommand = Command.make("inference").pipe(
  Command.withSubcommands([run, get]),
  Command.withDescription("Inference jobs: enqueue a prompt, read the answer")
)
