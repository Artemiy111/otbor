import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import type { ResumeBumpVerdict } from "./applyRules.ts"
import { resumeBumpJob } from "./jobs.ts"

/**
 * Подъём резюме в поиске («Поднять в поиске»).
 *
 * Расписание `resume_bump` только ставит задачи браузера, по одной на резюме:
 * нажимает кнопку харнесс, а облако по свидетельствам решает, поднялось ли
 * резюме, и записывает исход в `resume`. hh даёт один подъём в 4 часа, поэтому
 * облако не ставит новую задачу, пока с удачного нажатия не прошёл срок отдыха.
 * Отдых считается по часам облака: строка «Последнее — ...» на странице без года
 * и пояса, ей нельзя верить как моменту времени, она хранится как свидетельство.
 */

const STAGE = "resume_bump" as const

/** Срок отдыха после нажатия: hh разрешает подъём раз в 4 часа. */
export const DEFAULT_BUMP_COOLDOWN_HOURS = 4
/** Минимальный промежуток между любыми двумя попытками одного резюме. */
export const BUMP_ATTEMPT_GAP_MINUTES = 30
/** Верхняя граница случайной задержки старта задачи от расписания. */
export const DEFAULT_BUMP_JITTER_MINUTES = 1

export interface EnqueueBumpOptions {
  /** Только резюме этого аккаунта hh; без него - все аккаунты пользователя. */
  readonly hhAccountId?: string
  readonly cooldownHours?: number
  readonly jitterMinutes?: number
  readonly limit?: number
  readonly now?: Date
}

/**
 * Ставит `resume_bump` для опубликованных резюме, которые пора поднимать. Резюме
 * со статусом не `published`/`modified` (заблокированные, черновики, закрытые)
 * пропускаются (`modified` это опубликованное резюме с правками, оно поднимается),
 * как и те, что поднимали недавно или у которых уже есть активная задача.
 */
export const enqueueResumeBumps = (
  tx: Executor,
  userId: string,
  options: EnqueueBumpOptions = {}
): RepoEffect<{ readonly queued: number; readonly candidates: number }> =>
  Effect.gen(function*() {
    const now = options.now ?? new Date()
    const cooldownHours = Math.max(options.cooldownHours ?? DEFAULT_BUMP_COOLDOWN_HOURS, 0)
    const jitterMinutes = Math.max(options.jitterMinutes ?? DEFAULT_BUMP_JITTER_MINUTES, 0)
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200)
    const rested = new Date(now.getTime() - cooldownHours * 3_600_000)
    const gap = new Date(now.getTime() - BUMP_ATTEMPT_GAP_MINUTES * 60_000)

    const rows = yield* tx.execute(sql`
      select r.id::text as id, r.hh_account_id::text as hh_account_id, r.external_id, r.hash,
             h.session_profile as session_profile
      from resume r
      join hh_account h on h.id = r.hh_account_id and h.user_id = ${userId}
      where r.user_id = ${userId}
        and r.source = 'hh'
        and coalesce(r.status, 'published') in ('published', 'modified')
        and r.hash <> ''
        ${options.hhAccountId === undefined ? sql`` : sql`and r.hh_account_id = ${options.hhAccountId}::uuid`}
        and (r.last_bumped_at is null or r.last_bumped_at <= ${rested})
        and (r.last_bump_attempt_at is null or r.last_bump_attempt_at <= ${gap})
        and not exists (
          select 1 from harness_jobs j
          where j.stage = ${STAGE}
            and j.payload->>'resumeId' = r.id::text
            and j.status in ('pending', 'leased', 'running')
        )
      order by r.last_bumped_at asc nulls first, r.id
    `)
    const found = rows.rows as unknown as ReadonlyArray<{
      id: string
      hh_account_id: string
      external_id: string
      hash: string
      session_profile: string | null
    }>

    let queued = 0
    for (const row of found.slice(0, limit)) {
      const count = yield* tx.execute(
        sql`select count(*)::int as n from harness_jobs where stage = ${STAGE} and payload->>'resumeId' = ${row.id}`
      )
      const jitter = yield* Effect.sync(() => Math.random() * jitterMinutes * 60_000)
      yield* resumeBumpJob(tx, {
        userId,
        hhAccountId: row.hh_account_id,
        resumeId: row.id,
        externalId: row.external_id,
        hash: row.hash,
        canonicalUrl: `https://hh.ru/resume/${row.hash}`,
        sessionProfile: row.session_profile,
        sequence: ((count.rows[0] as { n: number } | undefined)?.n ?? 0) + 1,
        runAt: new Date(now.getTime() + jitter)
      })
      queued += 1
    }
    return { queued, candidates: found.length }
  })

/**
 * Записывает решение облака в резюме. Отдых (`last_bumped_at`) стартует и от
 * подтверждённого подъёма, и от нажатия без подтверждения: нажатие могло
 * дойти до hh, а второй раз нажимать нельзя. Недоступная кнопка отдых не
 * заводит, только запоминается как попытка.
 */
export const recordBump = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly resumeId: string
    readonly verdict: Extract<ResumeBumpVerdict, { _tag: "bumped" | "unconfirmed" | "unavailable" }>
    readonly now?: Date
  }
): RepoEffect<void> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    const { verdict } = input
    const outcome = verdict._tag
    const note =
      verdict._tag === "unavailable" ? verdict.label : verdict._tag === "unconfirmed" ? verdict.reason : null
    const text = verdict.lastBump
    const started = verdict._tag === "unavailable" ? null : now
    yield* tx.execute(sql`
      update resume set
        last_bump_attempt_at = ${now},
        last_bump_outcome = ${outcome},
        last_bump_text = ${text},
        last_bump_note = ${note},
        last_bumped_at = coalesce(${started}::timestamptz, last_bumped_at)
      where id = ${input.resumeId}::uuid and user_id = ${input.userId}
    `)
  })
