import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { nextSequence, reconcileJob, targetFor } from "./jobs.ts"

/**
 * Reclaims jobs whose performer stopped heartbeating.
 *
 * A prepare or reconcile job simply returns to the queue. A submit job does
 * not: the harness may have clicked before it died, so the job becomes
 * `needs_reconcile`, its open attempt is closed as ambiguous, and a reconcile
 * job reads the site. The application stays `submitting`; nothing here can
 * cause a second click.
 */
export const recoverExpiredLeases = (
  tx: Executor
): Effect.Effect<ReadonlyArray<QueueRepository.RecoveredJob>, DatabaseError> =>
  Effect.gen(function*() {
    const recovered = yield* QueueRepository.recoverExpired(tx)

    for (const job of recovered) {
      if (job.stage !== "submit" || job.applicationId === null) continue

      const attemptId = yield* ApplicationRepository.openAttempt(tx, job.applicationId, "submit")
      if (attemptId !== null) {
        yield* ApplicationRepository.finishAttempt(
          tx,
          attemptId,
          { tag: "ambiguous", message: "lease expired during submit; outcome unknown" },
          null
        )
      }

      const application = yield* ApplicationRepository.findAny(tx, job.applicationId)
      const target = application === null ? null : yield* targetFor(tx, application)
      if (target !== null) {
        yield* reconcileJob(tx, {
          ...target,
          sequence: yield* nextSequence(tx, target.applicationId, "reconcile")
        })
      }
    }

    return recovered
  })
