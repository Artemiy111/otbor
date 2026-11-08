import { Effect } from "effect"
import * as ApplicationRepository from "../../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../../repositories/ApplyFilterRepository.ts"
import * as SubmitPacingRepository from "../../repositories/SubmitPacingRepository.ts"
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
    // Список откликов нужен только когда у аккаунта есть другая заявка на
    // вакансию с другим резюме: иначе «вы откликнулись» на странице однозначно.
    // Считается заново: заявки могли появиться после постановки сверки.
    const needsResume =
      resumeExternalId !== null && (yield* ApplicationRepository.hasOtherResumeApplication(tx, application.id))
    const verdict = judgeReconcile(exit, vacancy.externalId, resumeExternalId, needsResume)
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
      // Provably no response. Ручная заявка возвращается в draft: человек
      // смотрит и одобряет заново. Автозаявка, чей режим всё ещё auto, уходит
      // в preparing и уйдёт снова сама (через шлюз, не здесь): после паузы
      // капчи, иначе с обычным автоповтором. Здесь ничего не ставится в очередь.
      const message = `reconciled: ${verdict.reason}`
      const settled = { status: "failed", result: { clicked: false, reconciled: true }, message } as const
      if (application.autoRun === "auto") {
        const mode = yield* ApplyFilterRepository.governingAutoMode(
          tx,
          application.userId,
          application.hhAccountId,
          application.resumeId ?? null
        )
        if (mode === "auto") {
          const pause = yield* SubmitPacingRepository.activePause(tx, application.hhAccountId)
          const spent = application.autoRetries ?? 0
          if (pause !== null) {
            return outcome("done", message, {
              appState: "preparing",
              appPatch: {
                lastError: "hh asked for a captcha; the response did not go out, it will be sent after the pause",
                blockedReason: "captcha",
                retryAt: pause.until
              },
              jobResult: { found: false, reading: verdict.reading },
              reconcileKept,
              settle: settled
            })
          }
          if (spent < ApplicationRepository.MAX_AUTO_RETRIES) {
            const wait =
              ApplicationRepository.AUTO_RETRY_BACKOFF_MS[spent] ?? ApplicationRepository.AUTO_RETRY_BACKOFF_MS.at(-1)!
            return outcome("done", message, {
              appState: "preparing",
              appPatch: {
                lastError: "the response did not reach hh; it will be sent again automatically",
                blockedReason: "submit_not_sent",
                retryAt: new Date(Date.now() + wait),
                autoRetries: spent + 1
              },
              jobResult: { found: false, reading: verdict.reading },
              reconcileKept,
              settle: settled
            })
          }
        }
      }
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
