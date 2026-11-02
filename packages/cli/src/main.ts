import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Console, Effect, Option } from "effect"
import { Command } from "effect/cli"
import "./env.ts"
import { ApiLayer } from "./client.ts"
import { applyCommand } from "./commands/apply.ts"
import { crawlCommand } from "./commands/crawl.ts"
import { dbCommand } from "./commands/db.ts"
import { decisionCommand } from "./commands/decision.ts"
import { gateCommand } from "./commands/gate.ts"
import { harnessCommand } from "./commands/harness.ts"
import { hydrateCommand } from "./commands/hydrate.ts"
import { lexiconCommand } from "./commands/lexicon.ts"
import { presetCommand } from "./commands/preset.ts"
import { proxyCommand } from "./commands/proxy.ts"
import { queueCommand } from "./commands/queue.ts"
import { healthCommand } from "./commands/system.ts"
import { vacancyCommand } from "./commands/vacancy.ts"

/**
 * One CLI, two kinds of commands:
 *
 * - product commands speak the same RPC group as the future web app, so a
 *   decision cannot be made twice in two places;
 * - `db` commands are local operator tools and may use the database directly.
 */
const root = Command.make("otbor").pipe(
  Command.withDescription("hh.ru application pipeline: corpus, gates, queue, harness")
)

/**
 * A refused decision is an answer, not a crash: print the typed message and
 * exit non-zero. Anything without a typed failure is a real defect and keeps
 * its full cause.
 */
const reportFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function*() {
    const failure = Cause.findErrorOption(cause)
    if (Option.isSome(failure)) {
      const error = failure.value
      yield* Console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      return
    }
    if (Cause.hasDies(cause)) {
      yield* Console.error(Cause.pretty(cause))
      process.exitCode = 1
    }
  })

root
  .pipe(
    Command.withSubcommands([
      healthCommand,
      dbCommand,
      vacancyCommand,
      gateCommand,
      lexiconCommand,
      decisionCommand,
      applyCommand,
      queueCommand,
      harnessCommand,
      presetCommand,
      crawlCommand,
      hydrateCommand,
      proxyCommand
    ]),
    Command.run({ version: "0.2.0" })
  )
  .pipe(
    Effect.catchCause(reportFailure),
    Effect.provide(ApiLayer),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain
  )
