import { Effect } from "effect"
import * as ApplicationRepository from "../../repositories/ApplicationRepository.ts"
import * as ResumeRepository from "../../repositories/ResumeRepository.ts"
import * as VacancyRepository from "../../repositories/VacancyRepository.ts"
import { judgeReconcile, reconcileArtifacts } from "../applyRules.ts"
import { retryLater } from "./common.ts"
import { outcome, type StageHandler } from "./types.ts"

/**
 * The harness only reports the pages it read. The cloud parses them and
 * decides; a bare tag settles nothing, and no verdict here can queue a second
 * submit.
 */
export const completeReconcile: StageHandler = (tx, ctx, exit) =>
  Effect.gen(function*() {
    const { job } = ctx
    const application =
      ctx.applicationId === null ? null : yield* ApplicationRepository.findAny(tx, ctx.applicationId)
    const vacancy = application ? yield* VacancyRepository.findById(tx, application.vacancyId) : null
    if (application === null || vacancy === null) {
      return outcome("failed", "reconciled, but the application or vacancy is gone", { appState: "failed" })
    }

    const resumeExternalId =
      application.resumeId === null || application.resumeId === undefined
        ? null
        : yield* ResumeRepository.externalIdOf(tx, application.resumeId)
    const verdict = judgeReconcile(exit, vacancy.externalId, resumeExternalId)
    const reconcileKept = reconcileArtifacts(exit, verdict)

    if (verdict._tag === "submitted") {
      const message = `reconciled: ${verdict.reason}`
      return outcome("done", message, {
        appState: "submitted",
        appPatch: { submittedAt: new Date(), lastError: null },
        jobResult: { found: true, reading: verdict.reading },
        reconcileKept,
        settle: { status: "done", result: { clicked: true, verified: "reconcile" }, message }
      })
    }
    if (verdict._tag === "unsent") {
      // Provably no response: back to draft so a person looks
      // again and approves again. Nothing is queued here.
      const message = `reconciled: ${verdict.reason}`
      return outcome("done", message, {
        appState: "draft",
        appPatch: { lastError: "the response did not reach hh; approve again to send it" },
        jobResult: { found: false, reading: verdict.reading },
        reconcileKept,
        settle: { status: "failed", result: { clicked: false, reconciled: true }, message }
      })
    }
    if (verdict._tag === "human") {
      return outcome("needs_human", `reconcile needs a human: ${verdict.reason}`, {
        appState: "needs_human",
        appPatch: { lastError: verdict.reason, blockedReason: "reconcile_unclear" },
        reconcileKept
      })
    }
    if (job.attempts < job.maxAttempts) {
      return outcome("pending", `reconcile retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`, {
        runAt: retryLater(exit, 60),
        reconcileKept
      })
    }
    return outcome("dead", `reconcile exhausted retries: ${verdict.reason}`, {
      appState: "needs_human",
      appPatch: {
        blockedReason: "reconcile_unclear",
        lastError: `could not confirm whether the response was sent: ${verdict.reason}`
      },
      reconcileKept
    })
  })
