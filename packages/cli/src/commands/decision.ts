import type { VacancyId } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { formatDecision, table } from "../format.ts"
import { resolveVacancyId } from "../resolve.ts"

const evaluate = Command.make(
  "evaluate",
  {
    vacancy: Argument.String("vacancy").pipe(Argument.withDescription("Vacancy id or prefix")),
    resume: Flag.String("resume").pipe(
      Flag.withDescription("Resume id used for fit scoring"),
      Flag.optional
    ),
    fit: Flag.Int("fit").pipe(
      Flag.withDescription("Override the computed fit (0-100)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ vacancy, resume, fit }) {
    const api = yield* Api
    const vacancyId = yield* resolveVacancyId(api, vacancy)
    const decision = yield* api.VacanciesEvaluate({
      vacancyId: vacancyId as VacancyId,
      resumeId: Option.getOrUndefined(resume),
      fit: Option.getOrUndefined(fit)
    })

    yield* Console.log(`${decision.vacancyTitle ?? decision.vacancyId}: ${decision.verdict}`)
    yield* Console.log(`gate: ${decision.gate}, fit: ${decision.fit}, priority: ${decision.priority}`)
    if (decision.reasons.length > 0) {
      yield* Console.log(
        `reasons: ${decision.reasons
          .map((reason) => `${reason.code}${reason.weight === undefined ? "" : `(${reason.weight})`}`)
          .join(", ")}`
      )
    }
    yield* Console.log(`decision: ${decision.id}`)
  })
).pipe(Command.withDescription("Evaluate one vacancy into a stored decision"))

const list = Command.make(
  "list",
  {
    verdict: Flag.String("verdict").pipe(
      Flag.withDescription("Filter by verdict (apply, draft, skip)"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    offset: Flag.Int("offset").pipe(Flag.withDefault(0)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ verdict, limit, offset, json }) {
    const api = yield* Api
    const decisions = yield* api.DecisionsList({
      verdict: Option.getOrUndefined(verdict),
      limit,
      offset
    })

    if (json) {
      yield* Console.log(JSON.stringify(decisions, null, 2))
      return
    }
    if (decisions.length === 0) {
      yield* Console.log("No decisions.")
      return
    }

    yield* Console.log(
      table(["id", "verdict", "gate", "fit", "priority", "vacancy", "reasons"], decisions.map(formatDecision))
    )
  })
).pipe(Command.withDescription("List stored decisions"))

export const decisionCommand = Command.make("decision").pipe(
  Command.withSubcommands([evaluate, list]),
  Command.withDescription("Deterministic decisions")
)
