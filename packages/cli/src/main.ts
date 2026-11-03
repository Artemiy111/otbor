import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Console, Effect, Option } from "effect"
import { Command } from "effect/cli"
import "./env.ts"
import { ApiLayer } from "./client.ts"
import { acpCommand } from "./commands/acp.ts"
import { applyCommand } from "./commands/apply.ts"
import { blacklistCommand } from "./commands/blacklist.ts"
import { hhCommand } from "./commands/hh.ts"
import { contactsCommand } from "./commands/contacts.ts"
import { crawlCommand } from "./commands/crawl.ts"
import { dbCommand } from "./commands/db.ts"
import { decisionCommand } from "./commands/decision.ts"
import { gateCommand } from "./commands/gate.ts"
import { harnessCommand } from "./commands/harness.ts"
import { hydrateCommand } from "./commands/hydrate.ts"
import { inferenceCommand } from "./commands/inference.ts"
import { lexiconCommand } from "./commands/lexicon.ts"
import { mailCommand } from "./commands/mail.ts"
import { mcpCommand } from "./commands/mcp.ts"
import { presetCommand } from "./commands/preset.ts"
import { proxyCommand } from "./commands/proxy.ts"
import { queueCommand } from "./commands/queue.ts"
import { scheduleCommand } from "./commands/schedule.ts"
import { healthCommand } from "./commands/system.ts"
import { doctorCommand, downCommand, statusCommand, upCommand } from "./commands/stack.ts"
import { telegramCommand } from "./commands/telegram.ts"
import { vacancyCommand } from "./commands/vacancy.ts"
import { writeCommand } from "./commands/write.ts"

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
 * Tagged errors such as `NotFound` carry fields, not a `message`. Fall back to
 * their JSON so the operator sees which entity or account was rejected.
 */
const describeFailure = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") return error.message
  const json = JSON.stringify(error)
  return json === undefined || json === "{}" ? String(error) : json
}

/**
 * A refused decision is an answer, not a crash: print the typed message and
 * exit non-zero. Anything without a typed failure is a real defect and keeps
 * its full cause.
 */
const reportFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function*() {
    const failure = Cause.findErrorOption(cause)
    if (Option.isSome(failure)) {
      yield* Console.error(`error: ${describeFailure(failure.value)}`)
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
      upCommand,
      downCommand,
      statusCommand,
      doctorCommand,
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
      blacklistCommand,
      hhCommand,
      crawlCommand,
      hydrateCommand,
      scheduleCommand,
      contactsCommand,
      mailCommand,
      telegramCommand,
      proxyCommand,
      acpCommand,
      inferenceCommand,
      writeCommand,
      mcpCommand
    ]),
    Command.run({ version: "0.2.0" })
  )
  .pipe(
    Effect.catchCause(reportFailure),
    Effect.provide(ApiLayer),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain
  )
