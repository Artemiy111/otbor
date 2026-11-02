import { Config, Effect, Layer, Schedule } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import "./env.ts"
import { Database } from "./db/Database.ts"
import * as QueueRepository from "./repositories/QueueRepository.ts"

/**
 * The worker is the only process that repairs leases. It does not execute
 * harness jobs: those belong to edge harnesses. It reclaims what a dead
 * performer left behind and keeps the account leases honest.
 */
const sweep = Effect.gen(function*() {
  const database = yield* Database

  const recovered = yield* database.asOwner((tx) => QueueRepository.recoverExpired(tx))
  if (recovered.length > 0) {
    yield* Effect.logWarning(`Recovered ${recovered.length} expired lease(s)`)
  }

  const stats = yield* database.asOwner((tx) => QueueRepository.stats(tx))
  yield* Effect.logDebug(
    `queue pending=${stats.pending} leased=${stats.leased} running=${stats.running} ` +
      `needsReconcile=${stats.needsReconcile} oldest=${stats.oldestPendingAgeSeconds}s`
  )
})

const program = Effect.gen(function*() {
  const interval = yield* Config.Number("WORKER_SWEEP_SECONDS").pipe(Config.withDefault(15))
  yield* Effect.logInfo(`Lease sweeper started (every ${interval}s)`)
  yield* sweep.pipe(Effect.repeat(Schedule.spaced(`${interval} seconds`)))
})

program.pipe(
  Effect.provide(Database.layer),
  Effect.catchCause((cause) => Effect.logError("Lease sweeper crashed", cause)),
  NodeRuntime.runMain
)
