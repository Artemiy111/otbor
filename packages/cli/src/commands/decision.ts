import type { VacancyId } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { formatDecision, table } from "../format.ts"
import { resolveVacancyId } from "../resolve.ts"

const evaluate = Command.make(
  "evaluate",
  {
    vacancy: Argument.String("vacancy").pipe(
      Argument.withDescription("Vacancy id or prefix (omit with --all)"),
      Argument.optional
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Evaluate every vacancy that lacks a current decision"),
      Flag.withDefault(false)
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("With --all: vacancies per batch (default 500, max 2000)"),
      Flag.withDefault(500)
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("With --all: re-evaluate vacancies whose decision is current"),
      Flag.withDefault(false)
    ),
    resume: Flag.String("resume").pipe(
      Flag.withDescription("Resume id used for fit scoring"),
      Flag.optional
    ),
    fit: Flag.Int("fit").pipe(
      Flag.withDescription("Override the computed fit (0-100)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ vacancy, all, limit, force, resume, fit }) {
    const api = yield* Api

    if (all) {
      // Batches until nothing is left; `--force` re-checks everything once
      // (a forced batch cannot tell "done" from "again", so it runs one batch).
      const totals = { evaluated: 0, apply: 0, draft: 0, skip: 0 }
      const byReason: Record<string, number> = {}
      let remaining = 0
      for (;;) {
        const batch = yield* api.DecisionsEvaluateBatch({
          limit,
          force,
          resumeId: Option.getOrUndefined(resume)
        })
        totals.evaluated += batch.evaluated
        totals.apply += batch.apply
        totals.draft += batch.draft
        totals.skip += batch.skip
        for (const [code, count] of Object.entries(batch.byReason)) {
          byReason[code] = (byReason[code] ?? 0) + count
        }
        remaining = batch.remaining
        yield* Console.log(
          `batch: ${batch.evaluated} evaluated (apply ${batch.apply}, draft ${batch.draft}, skip ${batch.skip}), ${batch.remaining} left`
        )
        if (force || batch.evaluated === 0 || batch.remaining === 0) break
      }
      yield* Console.log(
        `evaluated ${totals.evaluated}: apply ${totals.apply}, draft ${totals.draft}, skip ${totals.skip}; ${remaining} still without a current decision`
      )
      const reasons = Object.entries(byReason).sort((a, b) => b[1] - a[1])
      if (reasons.length > 0) {
        yield* Console.log(`by reason: ${reasons.map(([code, count]) => `${code}=${count}`).join(", ")}`)
      }
      return
    }

    if (Option.isNone(vacancy)) {
      return yield* Effect.die(new Error("pass a vacancy id, or --all to evaluate the whole corpus"))
    }
    const vacancyId = yield* resolveVacancyId(api, vacancy.value)
    const decision = yield* api.VacanciesEvaluate({
      vacancyId: vacancyId as VacancyId,
      resumeId: Option.getOrUndefined(resume),
      fit: Option.getOrUndefined(fit)
    })

    yield* Console.log(`${decision.vacancyTitle ?? decision.vacancyId}: ${decision.verdict}`)
    yield* Console.log(`fit: ${decision.fit}, priority: ${decision.priority}`)
    if (decision.reasons.length > 0) {
      yield* Console.log(
        `reasons: ${decision.reasons
          .map((reason) =>
            `${reason.code}${reason.weight === undefined ? "" : `(${reason.weight})`}${
              reason.code === "blocked_filter" && reason.detail ? `: ${reason.detail}` : ""
            }`
          )
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
    top: Flag.Int("top").pipe(
      Flag.withDescription("The N best decisions by priority, newest decision per vacancy"),
      Flag.optional
    ),
    minFit: Flag.Int("min-fit").pipe(
      Flag.withDescription("Only decisions with fit >= N"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    offset: Flag.Int("offset").pipe(Flag.withDefault(0)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ verdict, top, minFit, limit, offset, json }) {
    const api = yield* Api
    const decisions = yield* api.DecisionsList({
      verdict: Option.getOrUndefined(verdict),
      limit: Option.isSome(top) ? top.value : limit,
      offset,
      minFit: Option.getOrUndefined(minFit),
      ...(Option.isSome(top) ? { orderBy: "priority" as const, latestPerVacancy: true } : {})
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
      table(["id", "verdict", "fit", "priority", "vacancy", "reasons"], decisions.map(formatDecision))
    )
  })
).pipe(Command.withDescription("List stored decisions"))

export const decisionCommand = Command.make("decision").pipe(
  Command.withSubcommands([evaluate, list]),
  Command.withDescription("Deterministic decisions")
)
