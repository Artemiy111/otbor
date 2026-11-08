/** Стадии без разбора страниц: prepare (устарела), letter_attach, session. */
import { judgeLetterAttach } from "../applyRules.ts"
import { Effect } from "effect"
import { outcome, type StageHandler } from "./types.ts"

/** Replaced by `form_read`; a leftover job reads nothing. */
export const completePrepare: StageHandler = () =>
  Effect.succeed(outcome("cancelled", "prepare is replaced by form_read"))

export const completeLetterAttach: StageHandler = (_tx, _ctx, exit) =>
  Effect.sync(() => {
    // One attempt, never retried: a click that may have reached hh
    // is left for the operator to look at.
    const verdict = judgeLetterAttach(exit)
    if (verdict._tag === "sent") return outcome("done", "cover letter sent")
    if (verdict._tag === "human") return outcome("needs_human", `cover letter: ${verdict.reason}`)
    return outcome("failed", verdict.reason)
  })

export const completeSession: StageHandler = (_tx, _ctx, exit) =>
  Effect.sync(() =>
    exit.tag === "prepared"
      ? outcome("done", "session is usable")
      : outcome("needs_human", `session needs a human: ${exit.tag}`)
  )
