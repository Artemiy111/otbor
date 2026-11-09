import { loadCaptchaSolver } from "@otbor/local-models"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as SubmitPacingRepository from "../repositories/SubmitPacingRepository.ts"

/**
 * Автоповтор после капчи. Харнес уже пробовал решить её моделью несколько раз;
 * если не вышло, аккаунт блокируется. Но модель ошибается случайно, и следующая
 * капча (другая картинка) часто проходит, поэтому, пока решатель включён,
 * блокировка снимается сама через паузу, и раннер шлёт отклики заново.
 *
 * Предохранитель: если подряд несколько блокировок прошли без единого
 * подтверждённого отклика, автоповтор прекращается и ждёт человека, иначе
 * hh получал бы капчу каждые несколько минут вечно.
 */
export const CAPTCHA_AUTO_RESUME_DELAY_MINUTES = 10
export const CAPTCHA_AUTO_RESUME_MAX_FAILED_EPISODES = 3

export interface CaptchaAutoResumeOptions {
  readonly delayMinutes?: number
  readonly maxFailedEpisodes?: number
  /** Включён ли решатель; в тестах подменяется. */
  readonly solverEnabled?: () => boolean
}

/** Снимает блокировки, которым пора на повтор; возвращает id возобновлённых аккаунтов. */
export const resumeCaptchaBlocks = (options: CaptchaAutoResumeOptions = {}) =>
  Effect.gen(function*() {
    const enabled = options.solverEnabled ?? (() => loadCaptchaSolver() !== null)
    if (!enabled()) return [] as ReadonlyArray<string>
    const delay = options.delayMinutes ?? CAPTCHA_AUTO_RESUME_DELAY_MINUTES
    const maxFailed = options.maxFailedEpisodes ?? CAPTCHA_AUTO_RESUME_MAX_FAILED_EPISODES
    const database = yield* Database

    return yield* database.asOwner((tx) =>
      Effect.gen(function*() {
        const due = (yield* tx.execute(sql`
          select id, user_id from hh_account
          where submit_blocked_at is not null
            and submit_blocked_at <= now() - (${delay} * interval '1 minute')
        `)).rows as ReadonlyArray<{ id: string; user_id: string }>

        const resumed: Array<string> = []
        for (const account of due) {
          // Подряд идущие эпизоды без подтверждённых откликов, новые первыми.
          const episodes = (yield* tx.execute(sql`
            select submits_confirmed from hh_captcha_episode
            where hh_account_id = ${account.id}
            order by captcha_at desc
            limit ${maxFailed + 1}
          `)).rows as ReadonlyArray<{ submits_confirmed: number }>
          let failed = 0
          for (const episode of episodes) {
            if (episode.submits_confirmed > 0) break
            failed += 1
          }
          if (failed > maxFailed) continue
          yield* SubmitPacingRepository.resume(tx, account.user_id, account.id)
          resumed.push(account.id)
        }
        return resumed
      })
    )
  })
