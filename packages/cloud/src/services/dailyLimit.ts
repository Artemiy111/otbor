/**
 * Дневной лимит откликов: сколько откликов аккаунта считается и какой у него
 * предел. Слот занимается только в `submitGate.trySubmit`.
 */
import { DEFAULT_DAILY_LIMIT } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor } from "../db/Database.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"

/**
 * Откликов в сутки на аккаунт hh, когда у аккаунта нет строки apply filter и
 * не задан `OTBOR_DAILY_APPLY_LIMIT` (собственный лимит hh).
 */
export const DEFAULT_DAILY_APPLY_LIMIT = DEFAULT_DAILY_LIMIT

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Отклики одного аккаунта за последние 24 часа, которые идут в собственный
 * лимит hh, кто бы их ни сделал:
 * - строки otbor (`origin = 'otbor'`), одобренные и всё ещё действующие
 *   (queued, submitting, submitted), по `coalesce(intent_at, submitted_at)`:
 *   слот тратится при захвате, а не когда hh подтвердит;
 * - отклики, сделанные не здесь (`origin = 'imported'`: расширение браузера,
 *   `otbor hh sync`), по `coalesce(hh_responded_at, submitted_at)`, чтобы
 *   синхронизация старых откликов не считалась свежими.
 * `oldest` - момент, который освободит первый слот.
 */
export const recentSubmits = (tx: Executor, hhAccountId: string, excludeId: string | null = null) =>
  tx
    .execute(sql`
      select count(*)::int as used, min(r.at) as oldest
      from (
        select case when origin = 'otbor' then coalesce(intent_at, submitted_at)
                    else coalesce(hh_responded_at, submitted_at) end as at
        from application
        where hh_account_id = ${hhAccountId}
          and (${excludeId}::uuid is null or id <> ${excludeId}::uuid)
          and ((origin = 'otbor' and state in ('queued', 'submitting', 'submitted'))
            or (origin <> 'otbor' and state = 'submitted'))
      ) r
      where r.at > now() - interval '24 hours'
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as { used: number; oldest: Date | string | null } | undefined
        const oldest = row?.oldest == null ? null : new Date(row.oldest)
        return { used: row?.used ?? 0, oldest }
      })
    )

/**
 * Сериализует «посчитать и занять слот» для одного аккаунта hh до конца
 * транзакции. Без неё два параллельных одобрения видят один и тот же
 * последний свободный слот.
 */
export const lockAccountSlots = (tx: Executor, hhAccountId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"otbor:apply:" + hhAccountId}))`).pipe(Effect.asVoid)

/**
 * The daily limit of one account: the `daily_limit` of its account-level apply
 * filter row (resume null) when there is one, else the service default (the
 * `OTBOR_DAILY_APPLY_LIMIT` env, else 200).
 */
export const dailyLimitFor = (tx: Executor, userId: string, hhAccountId: string, fallback: number) =>
  ApplyFilterRepository.accountDailyLimit(tx, userId, hhAccountId).pipe(
    Effect.map((stored) => stored ?? fallback)
  )
