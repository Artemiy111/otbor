import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Effect, Option } from "effect"
import { HarnessGateway } from "./client.ts"
import { parseHarnessConfig } from "./config.ts"
import { runHarness } from "./run.ts"

/**
 * A typed failure is an answer (bad env, refused token): print it and exit
 * non-zero. A defect keeps its full cause because it is a bug in the harness.
 */
const reportFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function*() {
    const failure = Cause.findErrorOption(cause)
    if (Option.isSome(failure)) {
      const error = failure.value
      yield* Effect.logError(
        `error: ${error instanceof Error ? error.message : String(error)}`
      )
      process.exitCode = 1
      return
    }
    if (Cause.hasDies(cause)) {
      yield* Effect.logError(Cause.pretty(cause))
      process.exitCode = 1
    }
  })

const program = Effect.gen(function*() {
  const config = yield* parseHarnessConfig(process.env)
  yield* runHarness(config).pipe(Effect.provide(HarnessGateway.layer(config.apiUrl)))
})

program.pipe(
  Effect.catchCause(reportFailure),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
