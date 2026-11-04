import type { ResponseForm, VacancyFormState } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { vacancyFormState, vacancyFormVersion } from "../db/tables.ts"

/**
 * The response form of a vacancy. Versions are immutable and keyed by the form
 * hash; `vacancy_form_state` says which one hh shows now and when it was last
 * read. Shared across users, written only by the cloud.
 */

/** The stored form is trusted for a day; after that it is worth reading again. */
export const FORM_TTL_MS = 24 * 60 * 60 * 1000

type StateRow = {
  readonly status: "none" | "present" | "unreadable" | "gone"
  readonly checkedAt: Date
  readonly changedAt: Date
  readonly lastError: string | null
  readonly form: ResponseForm | null
  readonly url: string | null
  readonly versions: number
}

const readState = (tx: Executor, vacancyId: string): RepoEffect<StateRow | null> =>
  tx
    .execute(sql`
      select s.status, s.checked_at, s.changed_at, s.last_error,
             v.form, v.url,
             (select count(*)::int from vacancy_form_version x where x.vacancy_id = s.vacancy_id) as versions
      from vacancy_form_state s
      left join vacancy_form_version v on v.id = s.current_version_id
      where s.vacancy_id = ${vacancyId}
      limit 1
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as
          | {
              status: StateRow["status"]
              checked_at: Date | string
              changed_at: Date | string
              last_error: string | null
              form: ResponseForm | null
              url: string | null
              versions: number
            }
          | undefined
        return row === undefined
          ? null
          : {
              status: row.status,
              checkedAt: new Date(row.checked_at),
              changedAt: new Date(row.changed_at),
              lastError: row.last_error,
              form: row.form,
              url: row.url,
              versions: row.versions
            }
      })
    )

/** True while a form read for this vacancy is queued or running. */
export const isReading = (tx: Executor, vacancyId: string): RepoEffect<boolean> =>
  tx
    .execute(sql`
      select 1 from harness_jobs
      where stage = 'form_read'
        and status in ('pending', 'leased', 'running')
        and payload->>'vacancyId' = ${vacancyId}
      limit 1
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export const getState = (
  tx: Executor,
  vacancyId: string,
  now: Date = new Date()
): RepoEffect<VacancyFormState> =>
  Effect.gen(function*() {
    const state = yield* readState(tx, vacancyId)
    const reading = yield* isReading(tx, vacancyId)
    if (state === null) {
      return {
        vacancyId: vacancyId as VacancyFormState["vacancyId"],
        status: "unknown",
        form: null,
        url: null,
        checkedAt: null,
        changedAt: null,
        stale: true,
        reading,
        lastError: null,
        versions: 0
      }
    }
    return {
      vacancyId: vacancyId as VacancyFormState["vacancyId"],
      status: state.status,
      form: state.form,
      url: state.url,
      checkedAt: state.checkedAt.toISOString(),
      changedAt: state.changedAt.toISOString(),
      stale: now.getTime() - state.checkedAt.getTime() > FORM_TTL_MS,
      reading,
      lastError: state.lastError,
      versions: state.versions
    }
  })

/**
 * A successful read. The same hash only refreshes `last_seen_at`; a new hash
 * adds a version and moves `changed_at`. `form: null` records "no questions"
 * (`none`) or an archived vacancy (`gone`).
 */
export const recordRead = (
  tx: Executor,
  input: {
    readonly vacancyId: string
    readonly accountId: string | null
    readonly status: "none" | "present" | "unreadable" | "gone"
    readonly form: ResponseForm | null
    readonly url: string | null
  }
): RepoEffect<{ readonly changed: boolean }> =>
  Effect.gen(function*() {
    let versionId: string | null = null
    if (input.form !== null && input.url !== null) {
      const [row] = yield* tx
        .insert(vacancyFormVersion)
        .values({
          vacancyId: input.vacancyId,
          formHash: input.form.formHash,
          layout: input.form.layout,
          coverLetter: input.form.coverLetter,
          form: input.form,
          url: input.url
        })
        .onConflictDoUpdate({
          target: [vacancyFormVersion.vacancyId, vacancyFormVersion.formHash],
          set: { lastSeenAt: sql`now()`, url: sql`excluded.url` }
        })
        .returning({ id: vacancyFormVersion.id })
      versionId = row!.id
    }

    const [previous] = yield* tx
      .select({
        current: vacancyFormState.currentVersionId,
        status: vacancyFormState.status
      })
      .from(vacancyFormState)
      .where(sql`${vacancyFormState.vacancyId} = ${input.vacancyId}`)
      .limit(1)

    const changed = previous === undefined || previous.current !== versionId || previous.status !== input.status

    yield* tx
      .insert(vacancyFormState)
      .values({
        vacancyId: input.vacancyId,
        currentVersionId: versionId,
        status: input.status,
        checkedByAccountId: input.accountId
      })
      .onConflictDoUpdate({
        target: vacancyFormState.vacancyId,
        set: {
          currentVersionId: versionId,
          status: input.status,
          checkedAt: sql`now()`,
          changedAt: changed ? sql`now()` : vacancyFormState.changedAt,
          checkedByAccountId: input.accountId,
          lastError: null,
          lastErrorAt: null
        }
      })

    return { changed }
  })

/**
 * A read that did not succeed. The stored form and `checked_at` stay as they
 * were, so the form keeps looking stale instead of being read as "no questions".
 */
export const recordFailure = (
  tx: Executor,
  input: { readonly vacancyId: string; readonly message: string }
): RepoEffect<void> =>
  tx
    .execute(sql`
      update vacancy_form_state
         set last_error = ${input.message}, last_error_at = now()
       where vacancy_id = ${input.vacancyId}
    `)
    .pipe(Effect.asVoid)

/**
 * The layout was not recognized. An existing good form stays current and only
 * gets the error; a vacancy never read becomes `unreadable`, never "no questions".
 */
export const recordUnreadable = (
  tx: Executor,
  input: { readonly vacancyId: string; readonly accountId: string | null; readonly message: string }
): RepoEffect<void> =>
  tx
    .insert(vacancyFormState)
    .values({
      vacancyId: input.vacancyId,
      status: "unreadable",
      checkedByAccountId: input.accountId,
      lastError: input.message,
      lastErrorAt: new Date()
    })
    .onConflictDoUpdate({
      target: vacancyFormState.vacancyId,
      set: { lastError: input.message, lastErrorAt: sql`now()` }
    })
    .pipe(Effect.asVoid)
