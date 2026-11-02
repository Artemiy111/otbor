import type { Answer, ApplicationId, HarnessJob, HarnessJobId } from "@otbor/contract"
import { InferenceResult as InferenceResultSchema } from "@otbor/contract"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { resolveApplicationId } from "../resolve.ts"
import { parseAnswers, questionLines } from "../writing.ts"

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
      `Unable to read from stdin: ${cause instanceof Error ? cause.message : String(cause)}`
    )
})

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

const describeJob = (job: HarnessJob, json: boolean) =>
  json ? Console.log(JSON.stringify(job, null, 2)) : Console.log(job.id)

/** Wait, print in the selected format, and hand the settled job back. */
const settle = (
  job: HarnessJob,
  options: { readonly timeout: number; readonly json: boolean }
) =>
  Effect.gen(function*() {
    const outcome = yield* waitFor(job.id, options.timeout)
    if (options.json) {
      yield* Console.log(JSON.stringify(outcome, null, 2))
      if (
        outcome.timedOut ||
        outcome.job.status !== "done" ||
        resultText(outcome.job.result) === null
      ) {
        process.exitCode = 1
      }
      return outcome
    }
    yield* printSettled(outcome.job, outcome.timedOut)
    return outcome
  })

const usableText = (outcome: {
  readonly job: HarnessJob
  readonly timedOut: boolean
}): string | null => {
  if (outcome.timedOut || outcome.job.status !== "done") return null
  return resultText(outcome.job.result)
}

/* -------------------------------------------------------------------------- */
/* Shared flags                                                               */
/* -------------------------------------------------------------------------- */

const modelFlag = Flag.String("model").pipe(
  Flag.withDescription("Model the harness should use"),
  Flag.optional
)

const timeoutFlag = Flag.Int("timeout").pipe(
  Flag.withDescription("Seconds to wait for the result"),
  Flag.withDefault(180)
)

const noWaitFlag = Flag.Boolean("no-wait").pipe(
  Flag.withDescription("Enqueue and print the job id without polling"),
  Flag.withDefault(false)
)

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the job as JSON"),
  Flag.withDefault(false)
)

const timeoutError = (timeout: number) =>
  timeout <= 0
    ? Effect.fail(new Error("--timeout must be a positive number of seconds"))
    : Effect.void

/* -------------------------------------------------------------------------- */
/* Letter                                                                     */
/* -------------------------------------------------------------------------- */

const letter = Command.make(
  "letter",
  {
    id: Argument.String("application-id").pipe(
      Argument.withDescription("Application id or prefix")
    ),
    tone: Flag.String("tone").pipe(
      Flag.withDescription("Tone of the letter (defaults to professional and specific)"),
      Flag.optional
    ),
    length: Flag.Literals("length", ["short", "medium", "long"]).pipe(
      Flag.withDescription("Target letter length"),
      Flag.optional
    ),
    save: Flag.Boolean("save").pipe(
      Flag.withDescription("Replace the letter in the application's existing kit"),
      Flag.withDefault(false)
    ),
    model: modelFlag,
    timeout: timeoutFlag,
    noWait: noWaitFlag,
    json: jsonFlag
  },
  Effect.fn(function*({ id, tone, length, save, model, timeout, noWait, json }) {
    yield* timeoutError(timeout)
    if (noWait && save) {
      return yield* Effect.fail(new Error("--save needs the result; drop --no-wait"))
    }
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)

    const { job } = yield* api.WritingCoverLetter({
      applicationId,
      ...(Option.isSome(tone) ? { tone: tone.value } : {}),
      ...(Option.isSome(length) ? { length: length.value } : {}),
      ...(Option.isSome(model) ? { model: model.value } : {})
    })

    if (noWait) {
      yield* describeJob(job, json)
      return
    }

    const outcome = yield* settle(job, { timeout, json })
    if (!save) return

    const text = usableText(outcome)
    if (text === null) {
      yield* Console.error("not saved: the letter was not produced")
      process.exitCode = 1
      return
    }

    const detail = yield* api.ApplicationsGet({ id: applicationId })
    const kit = detail.kit
    if (kit === null || kit === undefined) {
      return yield* Effect.fail(
        new Error(
          `application ${applicationId} has no kit; run \`otbor apply kit ${applicationId} --form-hash ...\` first`
        )
      )
    }

    const record = yield* api.ApplicationsSetKit({
      applicationId: applicationId as ApplicationId,
      formHash: kit.formHash,
      letter: text,
      answers: kit.answers,
      model: kit.model ?? undefined,
      promptHash: kit.promptHash ?? undefined,
      costUsd: kit.costUsd ?? undefined
    })
    yield* Console.log(`saved letter: kit ${record.id} form=${record.formHash}`)
  })
).pipe(Command.withDescription("Write a cover letter for an application"))

/* -------------------------------------------------------------------------- */
/* Answers                                                                    */
/* -------------------------------------------------------------------------- */

const readQuestions = (flags: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    if (flags.length > 0) return flags

    if (process.stdin.isTTY) {
      return yield* Effect.fail(
        new Error("Pass --question at least once, or pipe one question per line on stdin")
      )
    }

    const questions = questionLines(yield* readStdin)
    if (questions.length === 0) {
      return yield* Effect.fail(new Error("No questions found on stdin"))
    }
    return questions
  })

const answers = Command.make(
  "answers",
  {
    id: Argument.String("application-id").pipe(
      Argument.withDescription("Application id or prefix")
    ),
    question: Flag.String("question").pipe(
      Flag.withDescription("Employer question (repeatable; defaults to stdin lines)"),
      Flag.between(0, 50)
    ),
    save: Flag.Boolean("save").pipe(
      Flag.withDescription("Best effort: save the parsed JSON into an existing kit"),
      Flag.withDefault(false)
    ),
    model: modelFlag,
    timeout: timeoutFlag,
    noWait: noWaitFlag,
    json: jsonFlag
  },
  Effect.fn(function*({ id, question, save, model, timeout, noWait, json }) {
    yield* timeoutError(timeout)
    if (noWait && save) {
      return yield* Effect.fail(new Error("--save needs the result; drop --no-wait"))
    }
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const questions = yield* readQuestions(question)

    const { job } = yield* api.WritingAnswers({
      applicationId,
      questions,
      ...(Option.isSome(model) ? { model: model.value } : {})
    })

    if (noWait) {
      yield* describeJob(job, json)
      return
    }

    const outcome = yield* settle(job, { timeout, json })
    if (!save) return

    const text = usableText(outcome)
    if (text === null) {
      yield* Console.error("not saved: the answers were not produced")
      process.exitCode = 1
      return
    }

    const parsed: ReadonlyArray<Answer> | null = parseAnswers(text)
    if (parsed === null) {
      yield* Console.error(
        "not saved: the answer is not a JSON array of { question, answer }; raw output follows"
      )
      yield* Console.error(text)
      process.exitCode = 1
      return
    }

    const detail = yield* api.ApplicationsGet({ id: applicationId })
    const kit = detail.kit
    if (kit === null || kit === undefined) {
      yield* Console.error(
        `not saved: application ${applicationId} has no kit; run \`otbor apply kit\` first`
      )
      process.exitCode = 1
      return
    }

    const record = yield* api.ApplicationsSetKit({
      applicationId: applicationId as ApplicationId,
      formHash: kit.formHash,
      letter: kit.letter ?? null,
      answers: parsed,
      model: kit.model ?? undefined,
      promptHash: kit.promptHash ?? undefined,
      costUsd: kit.costUsd ?? undefined
    })
    yield* Console.log(`saved answers: kit ${record.id} answers=${record.answers.length}`)
  })
).pipe(
  Command.withDescription("Answer employer test or questionnaire questions for an application")
)

/* -------------------------------------------------------------------------- */
/* Resume                                                                     */
/* -------------------------------------------------------------------------- */

const readResume = (file: Option.Option<string>) =>
  Effect.gen(function*() {
    if (Option.isSome(file)) {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.readFileString(file.value)
    }
    if (process.stdin.isTTY) {
      return yield* Effect.fail(
        new Error("Pass a resume file path, or pipe the resume text on stdin")
      )
    }
    return yield* readStdin
  })

const resume = Command.make(
  "resume",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("Resume text file (defaults to stdin)"),
      Argument.optional
    ),
    targetRole: Flag.String("target-role").pipe(
      Flag.withDescription("Role the rewrite should target"),
      Flag.optional
    ),
    model: modelFlag,
    timeout: timeoutFlag,
    noWait: noWaitFlag,
    json: jsonFlag
  },
  Effect.fn(function*({ file, targetRole, model, timeout, noWait, json }) {
    yield* timeoutError(timeout)
    const text = yield* readResume(file)
    if (text.trim() === "") {
      return yield* Effect.fail(new Error("Resume text is empty"))
    }

    const api = yield* Api
    const { job } = yield* api.WritingResume({
      text,
      ...(Option.isSome(targetRole) ? { targetRole: targetRole.value } : {}),
      ...(Option.isSome(model) ? { model: model.value } : {})
    })

    if (noWait) {
      yield* describeJob(job, json)
      return
    }

    yield* settle(job, { timeout, json })
  })
).pipe(Command.withDescription("Rewrite a resume for a target role"))

export const writeCommand = Command.make("write").pipe(
  Command.withSubcommands([letter, answers, resume]),
  Command.withDescription("Writing: cover letters, employer answers and resume rewrites")
)
