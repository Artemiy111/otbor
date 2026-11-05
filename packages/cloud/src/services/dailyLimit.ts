/**
 * The daily send cap, in one place. Approve, `setKit` and the `form_read`
 * completion path (auto-queued applications) all count and claim slots here.
 */
import type { ApplicationRecord } from "@otbor/contract"
import { DEFAULT_DAILY_LIMIT } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"

/**
 * Daily submits per hh account when the account has no apply filter row and
 * `OTBOR_DAILY_APPLY_LIMIT` is not set (hh's own limit).
 */
export const DEFAULT_DAILY_APPLY_LIMIT = DEFAULT_DAILY_LIMIT

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Applications of one account that were approved in the last 24 hours and
 * still stand (queued, submitting or submitted). `intent_at` is written when a
 * slot is claimed; rows without it fall back to `submitted_at`.
 * `oldest` is the timestamp that frees the first slot.
 */
export const recentSubmits = (tx: Executor, hhAccountId: string, excludeId: string | null = null) =>
  tx
    .execute(sql`
      select count(*)::int as used, min(coalesce(intent_at, submitted_at)) as oldest
      from application
      where hh_account_id = ${hhAccountId}
        and (${excludeId}::uuid is null or id <> ${excludeId}::uuid)
        and origin = 'otbor'
        and state in ('queued', 'submitting', 'submitted')
        and coalesce(intent_at, submitted_at) > now() - interval '24 hours'
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as { used: number; oldest: Date | string | null } | undefined
        const oldest = row?.oldest == null ? null : new Date(row.oldest)
        return { used: row?.used ?? 0, oldest }
      })
    )

/**
 * The daily limit of one account: the `daily_limit` of its account-level apply
 * filter row (resume null) when there is one, else the service default (the
 * `OTBOR_DAILY_APPLY_LIMIT` env, else 200).
 */
export const dailyLimitFor = (tx: Executor, userId: string, hhAccountId: string, fallback: number) =>
  ApplyFilterRepository.accountDailyLimit(tx, userId, hhAccountId).pipe(
    Effect.map((stored) => stored ?? fallback)
  )

export type SendSlot =
  | { readonly slot: true }
  | { readonly slot: false; readonly message: string }

/**
 * Claim a send slot for an application already in `queued` that is about to
 * get its submit job. With a free slot `intent_at` is stamped (it counts
 * against the cap from now on, not only once hh confirms). Without one the
 * application moves to `needs_human` with the reason and no job must be queued.
 */
export const claimSendSlot = Effect.fnUntraced(function*(
  tx: Executor,
  input: {
    readonly userId: string
    readonly application: Pick<ApplicationRecord, "id" | "hhAccountId">
    readonly fallbackLimit: number
  }
) {
  const { application } = input
  const recent = yield* recentSubmits(tx, application.hhAccountId, application.id)
  const dailyLimit = yield* dailyLimitFor(tx, input.userId, application.hhAccountId, input.fallbackLimit)
  if (recent.used >= dailyLimit) {
    const resetsAt = new Date((recent.oldest?.getTime() ?? Date.now()) + DAY_MS).toISOString()
    const message = `daily limit ${dailyLimit} reached; a slot frees at ${resetsAt}`
    yield* ApplicationRepository.transition(tx, input.userId, application.id, "needs_human", {
      from: ["queued"],
      patch: { lastError: message }
    })
    return { slot: false, message } as SendSlot
  }
  yield* ApplicationRepository.transition(tx, input.userId, application.id, "queued", {
    from: ["queued"],
    patch: { intentAt: new Date() }
  })
  return { slot: true } as SendSlot
})
