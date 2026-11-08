import { Effect } from "effect"
import { judgeSubmit } from "../applyRules.ts"
import { outcome, type StageHandler } from "./types.ts"

/**
 * The harness reports a claim, the cloud decides from the evidence. Only a page
 * the cloud itself reads as "you responded" settles a submit; anything that
 * might have reached hh goes to reconcile and is never sent again.
 */
export const completeSubmit: StageHandler = (_tx, _ctx, exit) =>
  Effect.sync(() => {
    const verdict = judgeSubmit(exit)
    if (verdict._tag === "submitted") {
      return outcome("done", "submitted; the response page confirmed it", {
        appState: "submitted",
        appPatch: { submittedAt: new Date(), lastError: null },
        jobResult: { clicked: true, verified: "page" }
      })
    }
    if (verdict._tag === "not_sent") {
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
