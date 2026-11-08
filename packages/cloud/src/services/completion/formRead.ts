import { type BlockedReason } from "@otbor/contract"
import { parseResponseForm } from "@otbor/hh"
import { Effect } from "effect"
import * as ApplicationRepository from "../../repositories/ApplicationRepository.ts"
import * as QueueRepository from "../../repositories/QueueRepository.ts"
import * as VacancyFormRepository from "../../repositories/VacancyFormRepository.ts"
import * as VacancyRepository from "../../repositories/VacancyRepository.ts"
import { judgePrepare } from "../applyRules.ts"
import { deferOrPark, parkWithCode } from "../blocked.ts"
import { negotiationsSyncJob } from "../jobs.ts"
import { trySubmit } from "../submitGate.ts"
import { retryLater } from "./common.ts"
import { outcome, type StageHandler } from "./types.ts"

/**
 * The form belongs to the vacancy: every applicant sees the same questions. The
 * harness delivers the page, the cloud parses it and keeps one version per
 * distinct form.
 */
export const completeFormRead: StageHandler = (tx, ctx, exit, options) =>
  Effect.suspend(() => {
    /** Заявки вакансии, которых ждала форма: раннер двигает их после коммита. */
    let waitingIds: ReadonlyArray<string> = []
    return Effect.gen(function*() {
      const { job } = ctx
      const verdict = judgePrepare(exit)
      const wanted = (job.payload as { vacancyId?: unknown } | null)?.vacancyId
      const vacancy = typeof wanted === "string" ? yield* VacancyRepository.findById(tx, wanted) : null
      // Заявки этой вакансии, ждущие формы: `preparing` и без submit-задачи
      // (с задачей отправка уже идёт, форма ей не нужна). Форма у вакансии
      // общая, а сбои чтения привязаны к аккаунту харнесса.
      const waiting =
        vacancy === null
          ? []
          : yield* Effect.filter(
              yield* ApplicationRepository.list(tx, ctx.userId, {
                state: "preparing",
                vacancyId: vacancy.id
              }),
              (application) =>
                QueueRepository.latestFor(tx, application.id, ["submit"]).pipe(
                  Effect.map((submit) => submit === null)
                )
            )
      /** Заявки аккаунта, чьим сеансом читали форму. */
      const own = waiting.filter((application) => application.hhAccountId === ctx.hhAccountId)
      const park = (
        targets: typeof waiting,
        state: "needs_human" | "skipped",
        reason: string,
        code: BlockedReason
      ) =>
        Effect.forEach(targets, (application) =>
          ApplicationRepository.transition(tx, ctx.userId, application.id, state, {
            from: ["preparing"],
            patch: state === "needs_human" ? { lastError: reason, blockedReason: code } : { lastError: reason }
          })
        )
      /** Сбой, зависящий от аккаунта (чужая вакансия, human, failed): паркуем только его заявки. */
      const parkOwn = (state: "needs_human" | "skipped", reason: string, code: BlockedReason) =>
        park(own, state, reason, code)
      /** Вердикт про саму вакансию (архив, нераспознанная раскладка): касается всех аккаунтов. */
      const parkAll = (state: "needs_human" | "skipped", reason: string, code: BlockedReason) =>
        park(waiting, state, reason, code)
      /**
       * Транзиентный сбой чтения: заявки аккаунта остаются `preparing` и ждут
       * повтор (1 ч, 4 ч, 12 ч); когда повторы кончились - `needs_human`.
       */
      const deferOwn = (reason: string) =>
        Effect.forEach(own, (application) => deferOrPark(tx, ctx.userId, application, "form_read_failed", reason))

      waitingIds = waiting.map((application) => application.id)

      if (vacancy === null) return outcome("failed", "form read, but the vacancy is gone")

      if (verdict._tag === "form") {
        const form = parseResponseForm(verdict.artifacts.html, verdict.artifacts.url)
        if (form.vacancyId !== "" && form.vacancyId !== vacancy.externalId) {
          const message = "the harness returned the form of another vacancy"
          yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
          yield* parkOwn("needs_human", message, "form_unreadable")
          return outcome("needs_human", message)
        }
        if (form.layout === "unknown") {
          const message = "the response form layout was not recognized"
          yield* VacancyFormRepository.recordUnreadable(tx, {
            vacancyId: vacancy.id,
            accountId: ctx.hhAccountId,
            message
          })
          yield* parkAll("needs_human", message, "form_unreadable")
          return outcome("needs_human", message)
        }
        const recorded = yield* VacancyFormRepository.recordRead(tx, {
          vacancyId: vacancy.id,
          accountId: ctx.hhAccountId,
          status: form.questions.length === 0 ? "none" : "present",
          form,
          url: verdict.artifacts.url
        })
        // Автозаявки любого аккаунта, чей кит подходит к этой форме, уходят
        // сейчас - через общий шлюз. Аккаунты по порядку id: блокировки
        // слотов берутся в одном порядке и не ждут друг друга по кругу.
        const ordered = [...waiting].sort((a, b) => a.hhAccountId.localeCompare(b.hhAccountId))
        for (const application of ordered) {
          const submitted = yield* trySubmit(tx, {
            userId: ctx.userId,
            application,
            trigger: "auto",
            fallbackLimit: options.dailyApplyLimit
          })
          if (submitted._tag === "refused" && submitted.reason === "kit_refused") {
            yield* parkWithCode(tx, ctx.userId, application.id, ["preparing"], "kit_refused", submitted.message)
          }
        }
        return outcome("done", recorded.changed ? "form read; the form changed" : "form read; unchanged")
      }

      if (verdict._tag === "skip") {
        const message = `form read skipped: ${verdict.reason}`
        if (verdict.reason.includes("archived")) {
          yield* VacancyFormRepository.recordRead(tx, {
            vacancyId: vacancy.id,
            accountId: ctx.hhAccountId,
            status: "gone",
            form: null,
            url: null
          })
        } else {
          yield* VacancyFormRepository.recordFailure(tx, {
            vacancyId: vacancy.id,
            message: verdict.reason
          })
        }
        // Архив - свойство вакансии; «hh уже держит отклик» - только этого аккаунта.
        if (verdict.reason.includes("archived")) yield* parkAll("skipped", verdict.reason, "form_gone")
        else yield* parkOwn("skipped", verdict.reason, "operator")
        if (exit.tag === "already_responded" && ctx.hhAccountId !== null) {
          // hh knows a response otbor does not: import it, so the
          // vacancy shows "responded" instead of a form error.
          const latest = yield* QueueRepository.latestForAccount(tx, ctx.hhAccountId, "negotiations_sync")
          if (latest === null || !["pending", "leased", "running"].includes(latest.job.status)) {
            const profile = (job.payload as { sessionProfile?: unknown } | null)?.sessionProfile
            yield* negotiationsSyncJob(tx, {
              userId: ctx.userId,
              hhAccountId: ctx.hhAccountId,
              sessionProfile: typeof profile === "string" ? profile : null,
              sequence: (yield* QueueRepository.countForAccount(tx, ctx.hhAccountId, "negotiations_sync")) + 1
            })
          }
        }
        return outcome("done", message)
      }

      if (verdict._tag === "human") {
        const message = `form read needs a human: ${verdict.reason}`
        yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
        yield* parkOwn("needs_human", verdict.reason, "form_read_failed")
        return outcome("needs_human", message)
      }

      if (verdict._tag === "failed") {
        yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message: verdict.reason })
        yield* deferOwn(verdict.reason)
        return outcome("failed", verdict.reason)
      }

      if (job.attempts < job.maxAttempts) {
        return outcome("pending", `form read retry ${job.attempts + 1}/${job.maxAttempts}: ${exit.tag}`, {
          runAt: retryLater(exit, 30)
        })
      }
      const message = `form read exhausted retries: ${exit.tag}`
      yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
      yield* deferOwn(message)
      return outcome("dead", message)
    }).pipe(
      // Любой исход, кроме повтора самой задачи: раннер двигает заявки вакансии
      // сразу после коммита, а не на следующем тике расписания.
      Effect.map((result) => (result.status === "pending" ? result : { ...result, advance: waitingIds }))
    )
  })
