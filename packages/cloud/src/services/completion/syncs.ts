/** Стадии, где харнесс отдаёт страницы, а облако их читает и импортирует. */
import { Effect } from "effect"
import { judgeChatRead, judgeNegotiationsSync, judgeResumeSync } from "../applyRules.ts"
import { importChat } from "../ChatSync.ts"
import { importTopics } from "../NegotiationsSync.ts"
import { importResumes } from "../ResumeSync.ts"
import { retryLater } from "./common.ts"
import { outcome, type StageHandler } from "./types.ts"

/**
 * The harness only delivers pages. The cloud reads them and imports; nothing
 * here touches an application of origin otbor.
 */
export const completeNegotiationsSync: StageHandler = (tx, ctx, exit) =>
  Effect.gen(function*() {
    const { job } = ctx
    const verdict = judgeNegotiationsSync(exit)
    if (verdict._tag === "read" && ctx.hhAccountId !== null) {
      const imported = yield* importTopics(tx, {
        userId: ctx.userId,
        hhAccountId: ctx.hhAccountId,
        topics: verdict.topics,
        pages: verdict.pages,
        complete: verdict.complete
      })
      return outcome(
        "done",
        `negotiations synced: ${imported.counts.imported} imported, ${imported.counts.updated} updated, ${imported.counts.unknownVacancy} unknown vacancy${verdict.complete ? "" : " (list not read to the end)"}`,
        { jobResult: { counts: imported.counts } }
      )
    }
    if (verdict._tag === "human") {
      return outcome("needs_human", `negotiations sync needs a human: ${verdict.reason}`)
    }
    if (verdict._tag === "read" || job.attempts >= job.maxAttempts) {
      return outcome(
        "dead",
        `negotiations sync gave up: ${verdict._tag === "read" ? "job has no account" : verdict.reason}`
      )
    }
    return outcome("pending", `negotiations sync retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`, {
      runAt: retryLater(exit, 120)
    })
  })

/**
 * The harness only delivers pages. The cloud reads them and stores the resumes;
 * the operator's enrichment is untouched.
 */
export const completeResumeSync: StageHandler = (tx, ctx, exit) =>
  Effect.gen(function*() {
    const { job } = ctx
    const verdict = judgeResumeSync(exit)
    if (verdict._tag === "read" && ctx.hhAccountId !== null) {
      const counts = yield* importResumes(tx, {
        userId: ctx.userId,
        hhAccountId: ctx.hhAccountId,
        found: verdict.found,
        resumes: verdict.resumes,
        unreadable: verdict.unreadable
      })
      return outcome(
        "done",
        `resumes synced: ${counts.imported} imported, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.unreadable} unreadable`,
        { jobResult: { counts } }
      )
    }
    if (verdict._tag === "human") return outcome("needs_human", `resume sync needs a human: ${verdict.reason}`)
    if (verdict._tag === "read" || job.attempts >= job.maxAttempts) {
      return outcome("dead", `resume sync gave up: ${verdict._tag === "read" ? "job has no account" : verdict.reason}`)
    }
    return outcome("pending", `resume sync retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`, {
      runAt: retryLater(exit, 120)
    })
  })

/**
 * The harness only delivers the JSON; the cloud parses it and stores the
 * messages. Read-only, so a retry is always safe.
 */
export const completeChatRead: StageHandler = (tx, ctx, exit) =>
  Effect.gen(function*() {
    const { job } = ctx
    const payload = job.payload as { vacancyId?: string; chatId?: string }
    const verdict =
      typeof payload.chatId === "string"
        ? judgeChatRead(exit, payload.chatId)
        : ({ _tag: "human", reason: "job has no chat id" } as const)
    if (verdict._tag === "read" && ctx.hhAccountId !== null && typeof payload.vacancyId === "string") {
      const counts = yield* importChat(tx, {
        userId: ctx.userId,
        hhAccountId: ctx.hhAccountId,
        vacancyId: payload.vacancyId,
        chat: verdict.chat
      })
      return outcome("done", `chat read: ${counts.inserted} new, ${counts.updated} known messages`, {
        jobResult: { counts }
      })
    }
    if (verdict._tag === "human") return outcome("needs_human", `chat read needs a human: ${verdict.reason}`)
    if (verdict._tag === "read" || job.attempts >= job.maxAttempts) {
      return outcome(
        "dead",
        `chat read gave up: ${verdict._tag === "read" ? "job has no account or vacancy" : verdict.reason}`
      )
    }
    return outcome("pending", `chat read retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`, {
      runAt: retryLater(exit, 30)
    })
  })
