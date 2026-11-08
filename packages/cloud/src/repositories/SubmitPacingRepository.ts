/**
 * Пауза отправок аккаунта после капчи. Темп (`submit_next_at`) пишет и читает
 * сам claim в `QueueRepository`; здесь только предохранитель.
 *
 * hh отвечает капчей на POST отклика, когда их идёт слишком много. Пока пауза
 * не вышла, claim не выдаёт действующие задачи аккаунта. Длина паузы фиксирована
 * (`OTBOR_ACCOUNT_CAPTCHA_PAUSE_SECONDS`, 300), без удвоения; сама проходит.
 */
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Пауза отправок после капчи по умолчанию, секунд. */
export const DEFAULT_CAPTCHA_PAUSE_SECONDS = 300

export interface SubmitPause {
  readonly until: Date
  readonly reason: "captcha"
}

const asDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | Date)

/**
 * Ставит паузу после капчи. Капча во время уже идущей паузы (читающая задача,
 * submit, который был в полёте) паузу не продлевает.
 */
export const recordCaptcha = (
  tx: Executor,
  hhAccountId: string,
  pauseSeconds: number = DEFAULT_CAPTCHA_PAUSE_SECONDS
): RepoEffect<SubmitPause> =>
  tx
    .execute(sql`
      update hh_account
      set submit_paused_until = case
            when submit_paused_until > now() then submit_paused_until
            else now() + make_interval(secs => ${pauseSeconds}) end,
          submit_pause_reason = 'captcha',
          updated_at = now()
      where id = ${hhAccountId}
      returning submit_paused_until
    `)
    .pipe(
      Effect.map((result) => ({
        until: asDate((result.rows[0] as { submit_paused_until?: unknown } | undefined)?.submit_paused_until) ?? new Date(),
        reason: "captcha" as const
      }))
    )

/** Действующая пауза аккаунта по часам базы; `null`, если её нет или она вышла. */
export const activePause = (tx: Executor, hhAccountId: string): RepoEffect<SubmitPause | null> =>
  tx
    .execute(sql`
      select submit_paused_until from hh_account
      where id = ${hhAccountId} and submit_paused_until > now()
    `)
    .pipe(
      Effect.map((result) => {
        const until = asDate((result.rows[0] as { submit_paused_until?: unknown } | undefined)?.submit_paused_until)
        return until === null ? null : { until, reason: "captcha" as const }
      })
    )
