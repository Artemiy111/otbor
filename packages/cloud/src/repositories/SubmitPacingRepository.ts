/**
 * Пауза отправок аккаунта после капчи и эпизоды капчи. Темп
 * (`submit_next_at`) и часовой лимит пишет и читает сам claim в
 * `QueueRepository`; здесь только предохранитель.
 *
 * hh отвечает капчей на POST отклика. Пока пауза стоит, claim не выдаёт
 * действующие задачи аккаунта (submit, letter_attach), читающие идут. Пауза
 * снимается сама в `submit_retry_at` (`captchaAutoResume`); каждая следующая
 * капча подряд без подтверждённых откликов удваивает паузу. Оператор может
 * снять её раньше (`resume`).
 */
import type { CaptchaEpisode } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Пауза после первой капчи, минут. */
export const CAPTCHA_BASE_DELAY_MINUTES = 5
/** Потолок нарастающей паузы, минут. */
export const CAPTCHA_MAX_DELAY_MINUTES = 60

/** Пауза после капчи: удваивается за каждую капчу подряд без единого отклика между ними. */
export const captchaDelayMinutes = (failedStreak: number): number =>
  Math.min(CAPTCHA_MAX_DELAY_MINUTES, CAPTCHA_BASE_DELAY_MINUTES * 2 ** Math.max(0, failedStreak - 1))

export interface SubmitBlock {
  readonly since: Date
  readonly reason: "captcha"
}

const asDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | Date)

/**
 * Останавливает отправки аккаунта после капчи и открывает эпизод со счётом
 * откликов. Капча при уже стоящей блокировке (читающая задача, submit, который
 * был в полёте) ничего не меняет: момент первой капчи сохраняется.
 * Возвращает `true`, если блокировку поставили сейчас.
 */
export const recordCaptcha = (tx: Executor, userId: string, hhAccountId: string): RepoEffect<boolean> =>
  Effect.gen(function*() {
    const [blocked] = (yield* tx.execute(sql`
      update hh_account
      set submit_blocked_at = now(), submit_block_reason = 'captcha', updated_at = now()
      where id = ${hhAccountId} and submit_blocked_at is null
      returning submit_resumed_at
    `)).rows as ReadonlyArray<{ submit_resumed_at: Date | string | null }>
    if (blocked === undefined) return false

    // Подтверждённые отклики с прошлого возобновления (или за всё время, если
    // его не было). Импортированные с hh вручную не считаются: это не наши отправки.
    const since = asDate(blocked.submit_resumed_at)
    yield* tx.execute(sql`
      insert into hh_captcha_episode (
        user_id, hh_account_id, captcha_at, submits_confirmed, first_submit_at, last_submit_at
      )
      select ${userId}, ${hhAccountId}, now(),
             count(*)::int, min(submitted_at), max(submitted_at)
      from application
      where hh_account_id = ${hhAccountId} and origin = 'otbor' and state = 'submitted'
        and submitted_at is not null
        and (${since}::timestamptz is null or submitted_at >= ${since}::timestamptz)
    `)

    // Подряд идущие эпизоды без подтверждённых откликов, новые первыми.
    const recent = (yield* tx.execute(sql`
      select submits_confirmed from hh_captcha_episode
      where hh_account_id = ${hhAccountId}
      order by captcha_at desc
      limit 12
    `)).rows as ReadonlyArray<{ submits_confirmed: number }>
    let streak = 0
    for (const episode of recent) {
      if (Number(episode.submits_confirmed) > 0) break
      streak += 1
    }
    const delay = captchaDelayMinutes(streak)
    yield* tx.execute(sql`
      update hh_account set submit_retry_at = now() + (${delay} * interval '1 minute')
      where id = ${hhAccountId}
    `)
    return true
  })

/** Блокировка аккаунта; `null`, если отправки идут. */
export const activeBlock = (tx: Executor, hhAccountId: string): RepoEffect<SubmitBlock | null> =>
  tx
    .execute(sql`select submit_blocked_at from hh_account where id = ${hhAccountId} and submit_blocked_at is not null`)
    .pipe(
      Effect.map((result) => {
        const since = asDate((result.rows[0] as { submit_blocked_at?: unknown } | undefined)?.submit_blocked_at)
        return since === null ? null : { since, reason: "captcha" as const }
      })
    )

/**
 * Снимает блокировку, закрывает открытый эпизод и возвращает раннеру
 * автозаявки, которые ждали капчу. Ничего не делает, если блокировки нет.
 * Возвращает id освобождённых заявок.
 */
export const resume = (tx: Executor, userId: string, hhAccountId: string): RepoEffect<ReadonlyArray<string>> =>
  Effect.gen(function*() {
    const unblocked = yield* tx.execute(sql`
      update hh_account
      set submit_blocked_at = null, submit_block_reason = null, submit_retry_at = null,
          submit_resumed_at = now(), updated_at = now()
      where id = ${hhAccountId} and user_id = ${userId} and submit_blocked_at is not null
      returning id
    `)
    if (unblocked.rows.length === 0) return []

    yield* tx.execute(sql`
      update hh_captcha_episode set resumed_at = now()
      where hh_account_id = ${hhAccountId} and resumed_at is null
    `)
    const released = yield* tx.execute(sql`
      update application
      set blocked_reason = null, retry_at = null, last_error = null, updated_at = now()
      where hh_account_id = ${hhAccountId} and user_id = ${userId}
        and state = 'preparing' and blocked_reason = 'captcha'
      returning id
    `)
    return (released.rows as ReadonlyArray<{ id: string }>).map((row) => row.id)
  })

/** Последние эпизоды капчи, новые первыми. */
export const episodes = (
  tx: Executor,
  userId: string,
  input: { readonly hhAccountId?: string | undefined; readonly limit: number }
): RepoEffect<ReadonlyArray<CaptchaEpisode>> =>
  tx
    .execute(sql`
      select id, hh_account_id, captcha_at, resumed_at, submits_confirmed, first_submit_at, last_submit_at
      from hh_captcha_episode
      where user_id = ${userId}
        and (${input.hhAccountId ?? null}::uuid is null or hh_account_id = ${input.hhAccountId ?? null}::uuid)
      order by captcha_at desc
      limit ${input.limit}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as ReadonlyArray<Record<string, unknown>>).map((row): CaptchaEpisode => {
          const iso = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string).toISOString())
          return {
            id: String(row.id),
            hhAccountId: String(row.hh_account_id) as CaptchaEpisode["hhAccountId"],
            captchaAt: iso(row.captcha_at)!,
            resumedAt: iso(row.resumed_at),
            submitsConfirmed: Number(row.submits_confirmed),
            firstSubmitAt: iso(row.first_submit_at),
            lastSubmitAt: iso(row.last_submit_at)
          }
        })
      )
    )
