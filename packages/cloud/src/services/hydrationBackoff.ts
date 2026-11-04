/**
 * Retry policy for hydration targets.
 *
 * A failed target is not retried on the next pass: each failure multiplies the
 * wait, up to one day. The cap matters as much as the growth: a company whose
 * page is gone forever must not be retried every 30 minutes, and it must not be
 * removed from the queue either, because hh pages come back.
 */

/** First wait after one failure. */
export const HYDRATION_BACKOFF_BASE_SECONDS = 30

/** The delay never exceeds one day; callers still see the target. */
export const HYDRATION_BACKOFF_CAP_SECONDS = 86_400

/** Failed this many times: shown as problematic, still retried at the cap. */
export const HYDRATION_POISON_ATTEMPTS = 5

/**
 * 2^attempts * base, capped. `attempts` is the number of failures already
 * recorded, so the first failure waits one minute.
 */
export const backoffSeconds = (attempts: number): number => {
  const safe = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0
  // Mirrors `delayAfter` in HydrationAttemptRepository: 30 * 2^attempts.
  const growth = 2 ** Math.min(Math.max(1, safe), 20)
  return Math.min(HYDRATION_BACKOFF_BASE_SECONDS * growth, HYDRATION_BACKOFF_CAP_SECONDS)
}

export const isPoisoned = (attempts: number): boolean =>
  attempts >= HYDRATION_POISON_ATTEMPTS
