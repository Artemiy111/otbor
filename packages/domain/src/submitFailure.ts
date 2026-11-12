/**
 * Предохранитель отправок: решает, пора ли остановить аккаунт, когда исполнитель
 * браузера раз за разом получает один и тот же детерминированный отказ.
 *
 * Чистые функции без базы: журнал попыток читает репозиторий облака и отдаёт сюда
 * последние завершённые попытки `submit` аккаунта (новые первыми).
 */

/** Сколько одинаковых отказов подряд останавливают отправки аккаунта. */
export const REPEATED_FAILURE_STREAK = 5
/** Первая пауза, минут (6 часов). */
export const REPEATED_FAILURE_BASE_DELAY_MINUTES = 6 * 60
/** Потолок паузы, минут (24 часа). */
export const REPEATED_FAILURE_MAX_DELAY_MINUTES = 24 * 60

/**
 * Исходы submit, которые детерминированы и не зависят от конкретной вакансии:
 * `blocked` (страница отклика не такая, как ждали: нет списка резюме, неузнанная
 * страница) и `resume_mismatch` (форма показывает не то резюме). Остальное
 * относится к вакансии (`answer_rejected`, `form_changed`, `already_responded`,
 * `vacancy_archived`, `relocation_warning`) или имеет свой механизм (`captcha`,
 * `session_expired`, `rate_limited`, `transport`, `ambiguous`).
 */
export const REPEATED_FAILURE_TAGS: ReadonlyArray<string> = ["blocked", "resume_mismatch"]

/** Исход завершённой попытки submit, как он записан в журнале. */
export interface SubmitAttemptExit {
  readonly tag: string
  readonly message: string | null
}

/**
 * Сообщение без изменчивых частей: числа от 5 цифр (id вакансий и резюме) и
 * названия в кавычках заменяются заглушками, лишние пробелы схлопываются.
 */
export const normalizeFailureMessage = (message: string | null | undefined): string =>
  (message ?? "")
    .replace(/"[^"]*"|«[^»]*»|“[^”]*”/g, "\"…\"")
    .replace(/\d{5,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()

export interface RepeatedFailurePause {
  /** Исходное сообщение последнего отказа: его покажем человеку. */
  readonly detail: string
  /** Сколько одинаковых отказов идут подряд (считая только последние `limit`). */
  readonly run: number
  readonly delayMinutes: number
}

/** Пауза для серии из `run` одинаковых отказов: 6 часов, дальше вдвое за каждый новый, до 24. */
export const repeatedFailureDelayMinutes = (run: number): number =>
  Math.min(
    REPEATED_FAILURE_MAX_DELAY_MINUTES,
    REPEATED_FAILURE_BASE_DELAY_MINUTES * 2 ** Math.max(0, run - REPEATED_FAILURE_STREAK)
  )

/** Сколько последних попыток нужно прочитать, чтобы увидеть и серию, и потолок паузы. */
export const REPEATED_FAILURE_WINDOW = REPEATED_FAILURE_STREAK + 2

/**
 * Решает, ставить ли паузу. `recent` - последние завершённые попытки `submit`
 * аккаунта, новые первыми. Пауза нужна, когда самые новые `REPEATED_FAILURE_STREAK`
 * попыток - один и тот же исход из `REPEATED_FAILURE_TAGS` с одним нормализованным
 * сообщением. Любая другая попытка в серии (успех, другой отказ) её обрывает.
 *
 * Удвоение считается по журналу, без счётчика: после автоснятия первая же попытка
 * с тем же отказом продлевает серию до N+1, и пауза снова ставится сразу, вдвое
 * длиннее. Журнал надёжнее счётчика: он не расходится с фактами и не требует
 * сброса. Ручное снятие серию не прерывает: если причину не починили, новый
 * отказ сразу остановит аккаунт снова.
 */
export const decideRepeatedFailure = (
  recent: ReadonlyArray<SubmitAttemptExit>,
  streak: number = REPEATED_FAILURE_STREAK
): RepeatedFailurePause | null => {
  const head = recent[0]
  if (head === undefined || !REPEATED_FAILURE_TAGS.includes(head.tag)) return null
  const key = normalizeFailureMessage(head.message)
  let run = 0
  for (const attempt of recent) {
    if (attempt.tag !== head.tag || normalizeFailureMessage(attempt.message) !== key) break
    run += 1
  }
  if (run < streak) return null
  return { detail: head.message ?? head.tag, run, delayMinutes: repeatedFailureDelayMinutes(run) }
}
