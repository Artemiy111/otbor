/**
 * Остановки заявок: типизированная причина (`blocked_reason`) и автоповтор.
 *
 * Транзиентная остановка автоотклика (дневной лимит, сбой письма, сбой чтения
 * формы) оставляет его в `preparing` с `retry_at`; раннер возобновляет его сам.
 * Постоянная - в `needs_human` с кодом. Сбои письма и чтения формы получают
 * не больше `MAX_AUTO_RETRIES` повторов с ожиданием 1 ч, 4 ч, 12 ч.
 */
import type { ApplicationRecord, BlockedReason } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"

/** Что стало с заявкой после транзиентного сбоя. */
export type DeferOutcome = "deferred" | "parked"

/**
 * Откладывает автоотклик на повтор или, когда повторы кончились, отдаёт
 * человеку с тем же кодом. `from` - состояния, из которых это разрешено.
 */
export const deferOrPark = (
  tx: Executor,
  userId: string,
  application: Pick<ApplicationRecord, "id" | "autoRetries">,
  code: BlockedReason,
  message: string,
  from: ReadonlyArray<ApplicationRecord["state"]> = ["preparing"]
): RepoEffect<DeferOutcome> =>
  Effect.gen(function*() {
    const spent = application.autoRetries ?? 0
    if (spent >= ApplicationRepository.MAX_AUTO_RETRIES) {
      yield* ApplicationRepository.transition(tx, userId, application.id, "needs_human", {
        from,
        patch: { lastError: message, blockedReason: code }
      })
      return "parked" as const
    }
    const wait = ApplicationRepository.AUTO_RETRY_BACKOFF_MS[spent] ?? ApplicationRepository.AUTO_RETRY_BACKOFF_MS.at(-1)!
    yield* ApplicationRepository.transition(tx, userId, application.id, "preparing", {
      from,
      patch: {
        lastError: message,
        blockedReason: code,
        retryAt: new Date(Date.now() + wait),
        autoRetries: spent + 1
      }
    })
    return "deferred" as const
  })

/** Автоотклик ждёт слот: остаётся `preparing`, раннер вернётся к нему, когда освободится первый слот. */
export const waitForSlot = (
  tx: Executor,
  userId: string,
  applicationId: string,
  message: string,
  resetsAt: string
): RepoEffect<void> =>
  ApplicationRepository.transition(tx, userId, applicationId, "preparing", {
    from: ["preparing"],
    patch: { lastError: message, blockedReason: "daily_cap", retryAt: new Date(resetsAt) }
  }).pipe(Effect.asVoid)

/** Заявка отдана человеку с кодом. */
export const parkWithCode = (
  tx: Executor,
  userId: string,
  applicationId: string,
  from: ReadonlyArray<ApplicationRecord["state"]>,
  code: BlockedReason,
  message: string
): RepoEffect<ApplicationRecord | null> =>
  ApplicationRepository.transition(tx, userId, applicationId, "needs_human", {
    from,
    patch: { lastError: message, blockedReason: code }
  })

/**
 * Освобождает ключ мёртвой задачи письма (`<key>:retried:<n>`), чтобы следующая
 * задача снова заняла обычный ключ `writingKey`. Историю и ошибку задача хранит.
 * Возвращает, переименована ли она (она могла измениться, пока мы читали).
 */
export const retireWritingJob = (tx: Executor, applicationId: string, jobId: string): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update harness_jobs
      set idempotency_key = idempotency_key || ':retried:' || (
            select count(*) + 1 from harness_jobs rj
            where rj.idempotency_key like ${`autoapply:writing:${applicationId}:%:retried:%`}
          )::text,
          updated_at = now()
      where id = ${jobId} and status in ('failed', 'dead', 'cancelled')
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))
