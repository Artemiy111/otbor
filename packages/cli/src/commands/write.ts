import type { ApplicationId, FormQuestion, HarnessJob, HarnessJobId } from "@otbor/contract"
import { InferenceResult as InferenceResultSchema } from "@otbor/contract"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { resolveApplicationId } from "../resolve.ts"
import { parseGeneratedDraft, type GeneratedDraft } from "@otbor/domain"

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

const languageFlag = Flag.Literals("language", ["auto", "ru", "en"]).pipe(
  Flag.withDescription(
    "Prompt language; auto detects it from the vacancy text (or the resume text)"
  ),
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
/* Draft: cover letter and form answers                                       */
/* -------------------------------------------------------------------------- */

/** The draft for people: the letter, then each answer under its question. */
const printDraft = (draft: GeneratedDraft, questions: ReadonlyArray<FormQuestion>) =>
  Effect.gen(function*() {
    yield* Console.log(draft.letter ?? "(no letter)")
    for (const answer of draft.answers) {
      const question = questions.find((candidate) => candidate.id === answer.questionId)
      const value = answer.optionIds === undefined
        ? (answer.text ?? "")
        : answer.optionIds
            .map((id) => question?.options.find((option) => option.id === id)?.label ?? id)
            .join(", ")
      yield* Console.log("")
      yield* Console.log(`? ${question?.text ?? answer.questionId}`)
      yield* Console.log(value)
    }
    for (const problem of draft.problems) yield* Console.error(`note: ${problem}`)
  })

const draft = Command.make(
  "draft",
  {
    id: Argument.String("application-id").pipe(
      Argument.withDescription("Application id or prefix")
    ),
    length: Flag.Literals("length", ["short", "medium", "long"]).pipe(
      Flag.withDescription("Letter ceiling: short 400, medium 700, long 1000 characters"),
      Flag.optional
    ),
    save: Flag.Boolean("save").pipe(
      Flag.withDescription("Replace the letter in the application's existing kit (answers stay as they are)"),
      Flag.withDefault(false)
    ),
    harness: Flag.String("harness").pipe(
      Flag.withDescription("Agent that writes the draft (defaults to the harness default)"),
      Flag.optional
    ),
    model: modelFlag,
    effort: Flag.String("effort").pipe(
      Flag.withDescription("Reasoning effort for the agent"),
      Flag.optional
    ),
    timeout: timeoutFlag,
    noWait: noWaitFlag,
    json: jsonFlag
  },
  Effect.fn(function*({ id, length, save, harness, model, effort, timeout, noWait, json }) {
    yield* timeoutError(timeout)
    if (noWait && save) {
      return yield* Effect.fail(new Error("--save needs the result; drop --no-wait"))
    }
    const api = yield* Api
    const applicationId = yield* resolveApplicationId(api, id)
    const detail = yield* api.ApplicationsGet({ id: applicationId })
    const application = detail.application

    // The same prompt as the web and the auto-apply runner.
    const { job } = yield* api.DraftGenerate({
      vacancyId: application.vacancyId,
      hhAccountId: application.hhAccountId,
      ...(application.resumeId == null ? {} : { resumeId: application.resumeId }),
      ...(Option.isSome(length) ? { length: length.value } : {}),
      ...(Option.isSome(harness) ? { harness: harness.value } : {}),
      ...(Option.isSome(model) ? { model: model.value } : {}),
      ...(Option.isSome(effort) ? { effort: effort.value } : {})
    })

    if (noWait) {
      yield* describeJob(job, json)
      return
    }

    const outcome = yield* waitFor(job.id, timeout)
    const text = usableText(outcome)
    if (json) {
      yield* Console.log(JSON.stringify(outcome, null, 2))
    } else if (text === null) {
      yield* printSettled(outcome.job, outcome.timedOut)
    }
    if (text === null) {
      process.exitCode = 1
      return
    }

    const questions = detail.form?.form.questions ?? []
    const parsed = parseGeneratedDraft(text, questions)
    if (!json) yield* printDraft(parsed, questions)
    if (!save) return

    if (parsed.letter === null) {
      yield* Console.error("not saved: the draft has no letter")
      process.exitCode = 1
      return
    }
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
      letter: parsed.letter,
      answers: kit.answers,
      model: kit.model ?? undefined,
      promptHash: kit.promptHash ?? undefined,
      costUsd: kit.costUsd ?? undefined
    })
    yield* Console.log(`saved letter: kit ${record.id} form=${record.formHash}`)
  })
).pipe(Command.withDescription("Write the cover letter and form answers for an application"))

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
    language: languageFlag,
    model: modelFlag,
    timeout: timeoutFlag,
    noWait: noWaitFlag,
    json: jsonFlag
  },
  Effect.fn(function*({ file, targetRole, language, model, timeout, noWait, json }) {
    yield* timeoutError(timeout)
    const text = yield* readResume(file)
    if (text.trim() === "") {
      return yield* Effect.fail(new Error("Resume text is empty"))
    }

    const api = yield* Api
    const { job } = yield* api.WritingResume({
      text,
      ...(Option.isSome(targetRole) ? { targetRole: targetRole.value } : {}),
      ...(Option.isSome(language) ? { language: language.value } : {}),
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
  Command.withSubcommands([draft, resume]),
  Command.withDescription("Writing: cover letter with form answers, and resume rewrites")
)
