import type { ApplicationRecord, StoredForm, VacancyFormState } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { hintsFor } from "./formHints.ts"
import { formReadJob } from "./jobs.ts"

/**
 * Queues a read of the vacancy's response form when the stored one is stale
 * (older than a day, or never read), or always with `force`. A read already
 * queued or running is reused. Creates no application. Returns the state as it
 * is now; `null` when the vacancy does not exist.
 */
export const requestFormRead = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly force?: boolean
    readonly priority?: number
  }
): Effect.Effect<VacancyFormState | null, DatabaseError> =>
  Effect.gen(function*() {
    const vacancy = yield* VacancyRepository.findById(tx, input.vacancyId)
    if (vacancy === null) return null

    const state = yield* VacancyFormRepository.getState(tx, vacancy.id)
    if ((input.force === true || state.stale) && !state.reading) {
      const profile = yield* tx.execute(
        sql`select session_profile from hh_account where id = ${input.hhAccountId} limit 1`
      )
      yield* formReadJob(tx, {
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        vacancyId: vacancy.id,
        externalId: vacancy.externalId,
        canonicalUrl: vacancy.canonicalUrl,
        sessionProfile: (profile.rows[0]?.session_profile as string | null | undefined) ?? null,
        priority: input.priority ?? 0
      })
      return yield* VacancyFormRepository.getState(tx, vacancy.id)
    }
    return state
  })

/**
 * The form an application is answered against: the vacancy's current version
 * plus the answer hints for this application's resume. `null` until a form with
 * a recognized layout was read.
 */
export const currentFormFor = (
  tx: Executor,
  application: ApplicationRecord
): Effect.Effect<StoredForm | null, DatabaseError> =>
  Effect.gen(function*() {
    const state = yield* VacancyFormRepository.getState(tx, application.vacancyId)
    if (state.form === null || state.url === null || state.checkedAt === null) return null
    const hints = yield* hintsFor(tx, application, state.form)
    return { form: state.form, hints, url: state.url, fetchedAt: state.checkedAt }
  })
