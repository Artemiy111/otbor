import type { FitJudgementRecord, PresetId, ResumeId, VacancyId } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId } from "../format.ts"
import { resolveVacancyId } from "../resolve.ts"

const printRecord = (record: FitJudgementRecord) =>
  Effect.gen(function*() {
    yield* Console.log(
      `status:   ${record.status}${record.status === "done" ? (record.current ? " (current)" : " (stale)") : ""}`
    )
    yield* Console.log(`source:   ${record.source}${record.model === null ? "" : ` (${record.model})`}`)
    yield* Console.log(`prompt:   ${record.promptVersion}`)
    yield* Console.log(`resume:   ${record.resumeId}`)
    if (record.inferenceJobId !== null) yield* Console.log(`job:      ${record.inferenceJobId}`)
    if (record.error !== null) yield* Console.log(`error:    ${record.error}`)
    yield* Console.log(`updated:  ${record.updatedAt}`)

    const judgement = record.judgement
    if (judgement === null) return
    yield* Console.log("")
    yield* Console.log(
      `fit ${judgement.fit} (${judgement.verdict}), confidence ${judgement.confidence.toFixed(2)}`
    )
    const section = (title: string, items: ReadonlyArray<string>) =>
      items.length === 0
        ? Effect.void
        : Console.log([`${title}:`, ...items.map((item) => `  - ${item}`)].join("\n"))
    yield* section("reasons", judgement.reasons)
    yield* section("disqualifiers", judgement.disqualifiers)
    yield* section("quotes", judgement.quotes)
  })

const enqueue = Command.make(
  "enqueue",
  {
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Vacancies per call (default 25, max 200)"),
      Flag.withDefault(25)
    ),
    preset: Flag.String("preset").pipe(
      Flag.withDescription("Only vacancies matching this preset id"),
      Flag.optional
    ),
    resume: Flag.String("resume").pipe(
      Flag.withDescription("Resume id to judge against (default: the active resume)"),
      Flag.optional
    ),
    all: Flag.Boolean("all-gated").pipe(
      Flag.withDescription("Include vacancies whose latest decision is not apply"),
      Flag.withDefault(false)
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("Re-judge vacancies that already have a current judgement"),
      Flag.withDefault(false)
    ),
    model: Flag.String("model").pipe(
      Flag.withDescription("Model the harness should use"),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ limit, preset, resume, all, force, model, json }) {
    const api = yield* Api
    const result = yield* api.FitJudgeEnqueue({
      limit,
      onlyApply: !all,
      force,
      ...(Option.isSome(preset) ? { presetId: preset.value as PresetId } : {}),
      ...(Option.isSome(resume) ? { resumeId: resume.value as ResumeId } : {}),
      ...(Option.isSome(model) ? { model: model.value } : {})
    })

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    yield* Console.log(
      `enqueued ${result.enqueued} fit job(s) for resume ${shortId(result.resumeId)}; ${result.remaining} more eligible`
    )
    yield* Console.log("a harness with kind=inference answers them; `otbor fit show <vacancy>` reads the result")
  })
).pipe(Command.withDescription("Queue LLM fit judgements for the best vacancies without a current one"))

const show = Command.make(
  "show",
  {
    vacancy: Argument.String("vacancy").pipe(Argument.withDescription("Vacancy id or prefix")),
    resume: Flag.String("resume").pipe(
      Flag.withDescription("Only the judgement for this resume"),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ vacancy, resume, json }) {
    const api = yield* Api
    const vacancyId = (yield* resolveVacancyId(api, vacancy)) as VacancyId
    const record = yield* api.FitJudgementGet({
      vacancyId,
      ...(Option.isSome(resume) ? { resumeId: resume.value as ResumeId } : {})
    })

    if (json) {
      yield* Console.log(JSON.stringify(record, null, 2))
      return
    }
    if (record === null) {
      yield* Console.log(`no fit judgement for ${shortId(vacancyId)}; run \`otbor fit enqueue\``)
      return
    }
    yield* printRecord(record)
  })
).pipe(Command.withDescription("Show the newest fit judgement of a vacancy"))

export const fitCommand = Command.make("fit").pipe(
  Command.withSubcommands([enqueue, show]),
  Command.withDescription("Personal fit judgements: enqueue LLM scoring, read results")
)
