import { Effect } from "effect"
import { judgeSubmit } from "../applyRules.ts"
import { requestNegotiationsRecheck } from "./negotiationsRecheck.ts"
import { outcome, type StageHandler } from "./types.ts"

/**
 * The harness reports a claim, the cloud decides from the evidence. Only a page
 * the cloud itself reads as "you responded" settles a submit; anything that
 * might have reached hh goes to reconcile and is never sent again.
 */
export const completeSubmit: StageHandler = (tx, ctx, exit) =>
  Effect.gen(function*() {
    const verdict = judgeSubmit(exit)
    if (verdict._tag === "submitted") {
      return outcome("done", "submitted; the response page confirmed it", {
        appState: "submitted",
        appPatch: { submittedAt: new Date(), lastError: null },
        jobResult: { clicked: true, verified: "page" }
      })
    }
    if (verdict._tag === "not_sent") {
      // Отклик не ушёл: частая причина - на hh он уже есть. Сверяем со списком.
      if (verdict.app !== "failed" && verdict.tag !== "form_changed") {
        yield* requestNegotiationsRecheck(tx, {
          userId: ctx.userId,
          hhAccountId: ctx.hhAccountId,
          sessionProfile: (ctx.job.payload as { sessionProfile?: unknown } | null)?.sessionProfile,
          exit
        })
      }
      return outcome(verdict.app === "failed" ? "failed" : "needs_human", `submit not sent: ${verdict.tag}`, {
        appState: verdict.app,
        appPatch: { lastError: verdict.reason, blockedReason: "submit_not_sent" },
        jobResult: { clicked: false, tag: verdict.tag }
      })
    }
    return outcome("needs_reconcile", verdict.reason, {
      appState: "submitting",
      enqueue: "reconcile",
      jobResult: { clicked: null }
    })
  })
