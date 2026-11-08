import type { HarnessExit, HarnessJob } from "@otbor/contract"
import { Effect } from "effect"
import { writingApplicationId } from "../AutoApplyRunner.ts"
import { exitDetail, retryLater } from "./common.ts"
import { outcome, type StageHandler, type StageOutcome } from "./types.ts"

const terminalFailure: ReadonlyArray<string> = [
  "permanent",
  "site_rejected",
  "resume_mismatch",
  "answer_rejected",
  "form_changed"
]

const needsHuman: ReadonlyArray<string> = ["captcha", "session_expired"]

const retryable: ReadonlyArray<string> = ["transport", "rate_limited", "inference_failed", "ambiguous"]

const decide = (job: HarnessJob, exit: HarnessExit): StageOutcome => {
  if (exit.tag === "prepared") {
    return outcome("done", "inference completed", { jobResult: exit.artifacts ?? null })
  }
  if (terminalFailure.includes(exit.tag)) return outcome("failed", `inference failed: ${exitDetail(exit)}`)
  if (needsHuman.includes(exit.tag)) {
    return outcome("needs_human", `inference needs a human: ${exitDetail(exit)}`)
  }
  if (retryable.includes(exit.tag)) {
    if (job.attempts < job.maxAttempts) {
      return outcome("pending", `inference retry ${job.attempts + 1}/${job.maxAttempts}: ${exitDetail(exit)}`, {
        runAt: retryLater(exit, 15)
      })
    }
    return outcome("dead", `inference exhausted retries: ${exitDetail(exit)}`)
  }
  return outcome("needs_human", `inference finished with unexpected exit: ${exitDetail(exit)}`)
}

/**
 * Письмо автозаявки (`autoapply:writing:<заявка>:...`) закончилось: раннер
 * сразу двигает эту заявку. Повтор задачи (`pending`) её не трогает.
 */
const withAdvance = (result: StageOutcome, idempotencyKey: string): StageOutcome => {
  const applicationId = writingApplicationId(idempotencyKey)
  return applicationId === null || result.status === "pending" ? result : { ...result, advance: [applicationId] }
}

export const completeInference: StageHandler = (_tx, ctx, exit) =>
  Effect.sync(() => withAdvance(decide(ctx.job, exit), ctx.idempotencyKey))
