import type { VacancyAnalysis, VacancyId } from "@otbor/contract"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { table } from "../format.ts"
import { resolveVacancyId } from "../resolve.ts"

const looksLikeHhReference = (value: string): boolean =>
  /^\d{3,}$/.test(value.trim()) || /hh\.[a-z]{2,3}\//i.test(value)

const stoppedLabel = (stoppedBy: "unreachable" | "unauthorized"): string =>
  stoppedBy === "unauthorized"
    ? "SystemOne отклонил ключ: проверьте OTBOR_SYSTEMONE_API_KEY"
    : "SystemOne недоступен: проверьте, что omlx запущен и OTBOR_SYSTEMONE_URL верный"

const run = Command.make(
  "run",
  {
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("How many vacancies to send to the model in this pass (max 500)"),
      Flag.withDefault(20)
    ),
    delay: Flag.Int("delay").pipe(
      Flag.withDescription("Pause between model calls, milliseconds"),
      Flag.withDefault(0)
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the pass as JSON"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ limit, delay, json }) {
    const api = yield* Api
    const result = yield* api.AnalysisRun({ limit, delayMs: delay })

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
    } else {
      yield* Console.log(
        `проанализировано ${result.analysed} · без изменений ${result.skipped}` +
          ` · ошибок ${result.failed} · просмотрено ${result.processed}`
      )
      for (const error of result.errors) yield* Console.log(`  ! ${error}`)
      if (result.stoppedBy !== null) yield* Console.error(`проход остановлен: ${stoppedLabel(result.stoppedBy)}`)
    }
    if (result.stoppedBy !== null) process.exitCode = 3
    else if (result.failed > 0 && result.analysed === 0) process.exitCode = 3
  })
).pipe(Command.withDescription("Run one bounded analysis pass over vacancies without a current analysis"))

const stats = Command.make(
  "stats",
  { json: Flag.Boolean("json").pipe(Flag.withDefault(false)) },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const result = yield* api.AnalysisStatsGet()
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    const percent = result.total === 0 ? 0 : Math.round((result.analysed / result.total) * 100)
    yield* Console.log(
      `промпт ${result.promptVersion}: проанализировано ${result.analysed} из ${result.total} ` +
        `полностью загруженных вакансий (${percent}%), осталось ${result.total - result.analysed}`
    )
  })
).pipe(Command.withDescription("How many vacancies have an analysis"))

const UNKNOWN = "неизвестно"

type Fact = { readonly value: unknown; readonly confidence: number } | null

const show1 = (fact: Fact): string =>
  fact === null ? UNKNOWN : `${String(fact.value)} (${fact.confidence.toFixed(2)})`

/** Rows of `[fact, value (confidence)]`; unknown (below threshold) facts read as unknown. */
export const factRows = (analysis: VacancyAnalysis): Array<[string, string]> => {
  const { redFlags, ...facts } = analysis.facts
  const rows = Object.entries(facts).map(([key, fact]): [string, string] => [key, show1(fact as Fact)])
  for (const [key, fact] of Object.entries(redFlags)) {
    rows.push([`redFlags.${key}`, show1(fact as Fact)])
  }
  return rows
}

const showCommand = Command.make(
  "show",
  {
    vacancy: Argument.String("vacancy").pipe(
      Argument.withDescription("Vacancy id, id prefix, hh.ru URL or external id")
    ),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ vacancy, json }) {
    const api = yield* Api
    const vacancyId: VacancyId = looksLikeHhReference(vacancy)
      ? (yield* api.VacancyFetch({ reference: vacancy })).vacancyId
      : yield* resolveVacancyId(api, vacancy)
    const analysis = yield* api.VacancyAnalysisGet({ vacancyId })

    if (json) {
      yield* Console.log(JSON.stringify(analysis, null, 2))
      return
    }
    if (analysis === null) {
      yield* Console.log(`вакансия ${vacancyId} ещё не проанализирована; запустите \`otbor analysis run\``)
      return
    }
    yield* Console.log(
      `модель ${analysis.model} · промпт ${analysis.promptVersion} · порог ${analysis.threshold} · ${analysis.updatedAt}\n` +
        `уверенность ниже порога показана как «${UNKNOWN}»\n`
    )
    yield* Console.log(table(["факт", "значение (уверенность)"], factRows(analysis)))
  })
).pipe(Command.withDescription("Show the stored analysis facts of a vacancy"))

export const analysisCommand = Command.make("analysis").pipe(
  Command.withSubcommands([run, stats, showCommand]),
  Command.withDescription("Local model analysis of vacancies (SystemOne)")
)
