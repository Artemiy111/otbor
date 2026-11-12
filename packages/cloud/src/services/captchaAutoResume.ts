import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as SubmitPacingRepository from "../repositories/SubmitPacingRepository.ts"

/**
 * Автоповтор после капчи: всегда включён. Капча ставит аккаунт на паузу до
 * `submit_retry_at`; когда срок вышел, пауза снимается сама и раннер шлёт
 * отклики заново. Пауза растёт вдвое за каждую капчу подряд без единого
 * подтверждённого отклика (`captchaDelayMinutes`), так что hh не получает
 * капчу каждые несколько минут, но и человека никто не ждёт.
 *
 * Так же снимается пауза `repeated_failure` (серия одинаковых отказов
 * исполнителя): у неё свой срок в `submit_retry_at`, 6 часов и больше.
 *
 * Строки без `submit_retry_at` (блокировка, поставленная до появления столбца)
 * получают базовую паузу от момента блокировки: для капчи минуты, для
 * `repeated_failure` её первые 6 часов.
 */
export const resumeCaptchaBlocks = () =>
  Effect.gen(function*() {
    const database = yield* Database
    return yield* database.asOwner((tx) =>
      Effect.gen(function*() {
        const due = (yield* tx.execute(sql`
          select id, user_id from hh_account
          where submit_blocked_at is not null
            and coalesce(
              submit_retry_at,
              submit_blocked_at + (
                case when submit_block_reason = 'repeated_failure'
                  then ${SubmitPacingRepository.REPEATED_FAILURE_FALLBACK_MINUTES}::int
                  else ${SubmitPacingRepository.CAPTCHA_BASE_DELAY_MINUTES}::int
                end * interval '1 minute')
            ) <= now()
        `)).rows as ReadonlyArray<{ id: string; user_id: string }>

        const resumed: Array<string> = []
        for (const account of due) {
          yield* SubmitPacingRepository.resume(tx, account.user_id, account.id)
          resumed.push(account.id)
        }
        return resumed
      })
    )
  })
