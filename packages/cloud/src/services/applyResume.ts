import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor } from "../db/Database.ts"

export interface ApplyResume {
  readonly id: string
  readonly title: string
  /** True when the resume was picked by the account fallback, not named by the decision. */
  readonly fallback: boolean
}

interface ResumeRow {
  readonly id: string
  readonly title: string
  readonly is_active: boolean
}

/**
 * THE rule for which resume an auto-apply uses, for the response, the letter and
 * the preview alike (never decide it anywhere else):
 *
 * 1. the decision's own resume, when it has one;
 * 2. else the account's ACTIVE resumes: exactly one -> it; several -> the most
 *    recently updated one (`updated_at desc, id` as a stable tie-break);
 * 3. else (none active) the account's only resume, when there is exactly one;
 * 4. else `null`: the caller parks the application for a human. Nothing is
 *    ever sent with an implicit (hh-preselected) resume.
 */
export const resolveApplyResume = (
  tx: Executor,
  userId: string,
  hhAccountId: string,
  decisionResumeId: string | null | undefined
): Effect.Effect<ApplyResume | null, any> =>
  Effect.gen(function*() {
    const result = yield* tx.execute(sql`
      select id, title, is_active from resume
      where user_id = ${userId} and hh_account_id = ${hhAccountId}
      order by is_active desc, updated_at desc, id asc
    `)
    const rows = result.rows as unknown as ReadonlyArray<ResumeRow>
    if (decisionResumeId !== null && decisionResumeId !== undefined) {
      const own = rows.find((row) => row.id === decisionResumeId)
      if (own !== undefined) return { id: own.id, title: own.title, fallback: false }
      // Not among the account's resumes (should not happen): fall through to the title lookup.
      const [lookup] = (yield* tx.execute(
        sql`select id, title from resume where id = ${decisionResumeId} and user_id = ${userId} limit 1`
      )).rows as unknown as ReadonlyArray<{ id: string; title: string }>
      return lookup === undefined ? null : { id: lookup.id, title: lookup.title, fallback: false }
    }
    // The query is ordered active first, then most recently updated.
    const active = rows.filter((row) => row.is_active)
    if (active.length > 0) return { id: active[0]!.id, title: active[0]!.title, fallback: true }
    if (rows.length === 1) return { id: rows[0]!.id, title: rows[0]!.title, fallback: true }
    return null
  })

/** Titles of every resume of the account, for the preview note. */
export const accountResumeTitles = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): Effect.Effect<ReadonlyArray<{ readonly id: string; readonly title: string }>, any> =>
  tx
    .execute(sql`
      select id, title from resume
      where user_id = ${userId} and hh_account_id = ${hhAccountId}
      order by is_active desc, updated_at desc, id asc
    `)
    .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<{ id: string; title: string }>))

export const NO_RESUME_MESSAGE =
  "не выбрано резюме для откликов: у решения нет резюме, а у аккаунта нет активного или единственного резюме. Выберите резюме или создайте фильтр для пары аккаунт + резюме"
