import { Effect } from "effect"
import type { Database } from "../db/Database.ts"
import * as ScheduleRunRepository from "../repositories/ScheduleRunRepository.ts"

const BEAT_EVERY = "30 seconds"

/**
 * Runs `effect` while a side fiber keeps the run's heartbeat fresh, so a long
 * step that reports no progress is not mistaken for a dead run. The beat stops
 * with the run, and a failed beat is only logged.
 */
export const withRunHeartbeat = <A, E, R>(
  database: Database["Service"],
  runId: string | null,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  if (runId === null) return effect
  const beat = Effect.sleep(BEAT_EVERY).pipe(
    Effect.andThen(database.asOwner((tx) => ScheduleRunRepository.heartbeat(tx, runId))),
    Effect.catchCause((cause) => Effect.logWarning(`schedule run ${runId}: heartbeat failed`, cause)),
    Effect.forever
  )
  return Effect.raceFirst(effect, beat)
}
