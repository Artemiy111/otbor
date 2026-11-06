import type {
  ApiError,
  ApplicationRecord,
  BrowserDraft,
  BrowserDrafts,
  BrowserSubmitResult,
  FormAnswer,
  KitAnswer
} from "@otbor/contract"
import { hasRespondedMarker } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

/**
 * The operator's own browser on hh.ru, through the extension.
 *
 * `drafts` hands the extension the kits it pastes into a response form the
 * operator opened by hand. `recordSubmit` stores what the operator sent with
 * hh's own button: the cloud reads the evidence itself and never queues a job,
 * so this path cannot submit anything and cannot double a submit.
 */

const NIL_RESUME = "00000000-0000-0000-0000-000000000000"
/** The kit key for an application whose form was never read (same as the web). */
const NO_FORM = "no-form"

export interface BrowserSubmitInput {
  readonly kind: "submit" | "letter"
  readonly externalId: string
  readonly resumeTitle: string | null
  readonly letter: string | null
  readonly answers: ReadonlyArray<FormAnswer>
  readonly formHash: string | null
  readonly url: string
  readonly evidence: string
}

export interface BrowserApplyShape {
  readonly drafts: (externalId: string) => Effect.Effect<BrowserDrafts, ApiError>
  readonly recordSubmit: (input: BrowserSubmitInput) => Effect.Effect<BrowserSubmitResult, ApiError>
}

const isFormAnswer = (answer: KitAnswer): answer is FormAnswer => "questionId" in answer

const blank = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

interface DraftRow {
  readonly id: string
  readonly hh_account_id: string
  readonly account_name: string | null
  readonly resume_id: string | null
  readonly resume_title: string | null
  readonly state: string
  readonly updated_at: Date | string
  readonly form_hash: string | null
  readonly letter: string | null
  readonly answers: ReadonlyArray<KitAnswer> | null
  readonly pending_letter: string | null
}

const vacancyIdOf = (tx: Executor, externalId: string) =>
  tx
    .execute(sql`select id from vacancy where source = 'hh' and external_id = ${externalId} limit 1`)
    .pipe(Effect.map((result) => (result.rows[0]?.id as string | undefined) ?? null))

interface Target {
  readonly hhAccountId: string
  readonly resumeId: string | null
}

/** An application in one of these states is the one the operator is sending now. */
const OPEN_STATES = new Set(["draft", "needs_human", "failed", "queued"])

/**
 * Which account and resume the browser responded with. The form names the
 * resume only by title, and two accounts may hold resumes with the same title,
 * so a tie goes to the resume whose application is still open for this
 * vacancy, then to one that has not responded yet, then to the default account.
 * Without a title: the only waiting application, the only account, the default one.
 */
const resolveTarget = (
  tx: Executor,
  vacancyId: string,
  resumeTitle: string | null
): Effect.Effect<Target | null, unknown> =>
  Effect.gen(function*() {
    if (resumeTitle !== null) {
      const byTitle = yield* tx.execute(sql`
        select r.id, r.hh_account_id, h.is_default,
          (select a.state from application a
           where a.vacancy_id = ${vacancyId} and a.hh_account_id = r.hh_account_id and a.resume_id = r.id
           limit 1) as app_state
        from resume r join hh_account h on h.id = r.hh_account_id
        where btrim(r.title) = ${resumeTitle}
        order by r.is_active desc, r.updated_at desc`)
      const rows = byTitle.rows as unknown as ReadonlyArray<{
        id: string
        hh_account_id: string
        is_default: boolean
        app_state: string | null
      }>
      const only = (list: ReadonlyArray<(typeof rows)[number]>) =>
        list.length === 1 ? { hhAccountId: list[0]!.hh_account_id, resumeId: list[0]!.id } : null
      const chosen =
        only(rows) ??
        only(rows.filter((row) => row.app_state !== null && OPEN_STATES.has(row.app_state))) ??
        only(rows.filter((row) => row.app_state !== "submitted" && row.app_state !== "submitting")) ??
        only(rows.filter((row) => row.is_default))
      if (chosen !== null) return chosen
    }

    const waiting = yield* tx.execute(sql`
      select hh_account_id, resume_id from application
      where vacancy_id = ${vacancyId} and state in ('draft', 'needs_human', 'failed', 'queued')`)
    const apps = waiting.rows as unknown as ReadonlyArray<{ hh_account_id: string; resume_id: string | null }>
    if (apps.length === 1) return { hhAccountId: apps[0]!.hh_account_id, resumeId: apps[0]!.resume_id }

    const accounts = yield* tx.execute(sql`select id, is_default from hh_account order by is_default desc, created_at asc`)
    const all = accounts.rows as unknown as ReadonlyArray<{ id: string; is_default: boolean }>
    if (!(all.length === 1 || all[0]?.is_default === true)) return null
    const hhAccountId = all[0]!.id
    if (resumeTitle === null) return { hhAccountId, resumeId: null }
    // The account is known; its resume by that title is the one, when it has exactly one.
    const own = yield* tx.execute(sql`
      select id from resume where hh_account_id = ${hhAccountId} and btrim(title) = ${resumeTitle}`)
    return { hhAccountId, resumeId: own.rows.length === 1 ? (own.rows[0]!.id as string) : null }
  })

export class BrowserApply extends Context.Service<BrowserApply, BrowserApplyShape>()(
  "otbor/cloud/BrowserApply"
) {
  static readonly layer = Layer.effect(
    BrowserApply,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const drafts: BrowserApplyShape["drafts"] = (externalId) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const vacancyId = yield* vacancyIdOf(tx, externalId)
              if (vacancyId === null) return { vacancyId: null, drafts: [] } satisfies BrowserDrafts
              const result = yield* tx.execute(sql`
                select a.id, a.hh_account_id, coalesce(h.label, nullif(btrim(concat_ws(' ', h.first_name, h.last_name)), '')) as account_name,
                  a.resume_id, r.title as resume_title, a.state, a.updated_at,
                  k.form_hash, k.letter, k.answers, ld.letter as pending_letter
                from application a
                join hh_account h on h.id = a.hh_account_id
                left join resume r on r.id = a.resume_id
                left join lateral (
                  select form_hash, letter, answers from application_kit
                  where application_id = a.id order by created_at desc limit 1
                ) k on true
                left join letter_draft ld on ld.hh_account_id = a.hh_account_id and ld.vacancy_id = a.vacancy_id
                  and ld.resume_id = coalesce(a.resume_id, ${NIL_RESUME}::uuid)
                where a.vacancy_id = ${vacancyId} and a.state <> 'skipped'
                order by a.updated_at desc`)
              const rows = result.rows as unknown as ReadonlyArray<DraftRow>
              return {
                vacancyId: vacancyId as BrowserDrafts["vacancyId"],
                drafts: rows.map(
                  (row): BrowserDraft => ({
                    applicationId: row.id as BrowserDraft["applicationId"],
                    hhAccountId: row.hh_account_id as BrowserDraft["hhAccountId"],
                    accountName: row.account_name,
                    resumeId: row.resume_id as BrowserDraft["resumeId"],
                    resumeTitle: row.resume_title,
                    state: row.state as BrowserDraft["state"],
                    formHash: row.form_hash,
                    letter: blank(row.letter),
                    answers: (row.answers ?? []).filter(isFormAnswer),
                    pendingLetter: blank(row.pending_letter),
                    updatedAt: new Date(row.updated_at).toISOString()
                  })
                )
              } satisfies BrowserDrafts
            })
          )
          .pipe(Effect.mapError(toStorageError("browser.drafts")))

      const result = (
        status: BrowserSubmitResult["status"],
        application: ApplicationRecord | null,
        message: string | null = null
      ): BrowserSubmitResult => ({ status, application, message })

      const recordSubmit: BrowserApplyShape["recordSubmit"] = Effect.fn("BrowserApply.recordSubmit")(
        function*(input) {
          // The cloud's own reading of the page, as for the harness: no "responded", no record.
          if (!hasRespondedMarker(input.evidence)) {
            return result("unconfirmed", null, "the page after the click shows no response")
          }
          const resumeTitle = blank(input.resumeTitle)
          const letter = blank(input.letter)
          return yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const vacancyId = yield* vacancyIdOf(tx, input.externalId)
                if (vacancyId === null) {
                  return result("unknown_vacancy", null, `vacancy ${input.externalId} is not in the corpus`)
                }
                const target = yield* resolveTarget(tx, vacancyId, resumeTitle)
                if (target === null) {
                  return result("no_account", null, "cannot tell which hh account responded; set a default account")
                }

                // The row for this resume, else one whose resume is unknown.
                const found = yield* tx.execute(sql`
                  select id, state from application
                  where hh_account_id = ${target.hhAccountId} and vacancy_id = ${vacancyId}
                    and (resume_id is not distinct from ${target.resumeId}::uuid or resume_id is null)
                  order by (resume_id is not distinct from ${target.resumeId}::uuid) desc, created_at asc
                  limit 1`)
                const existing = found.rows[0] as { id: string; state: ApplicationRecord["state"] } | undefined

                let applicationId: string
                let state: ApplicationRecord["state"]
                if (existing === undefined) {
                  // Made by hand on hh.ru: the same origin the negotiations sync gives such a row.
                  const inserted = yield* tx.execute(sql`
                    insert into application (user_id, hh_account_id, vacancy_id, resume_id, state, origin,
                      hh_responded_at, submitted_at)
                    values (${currentUser.userId}, ${target.hhAccountId}, ${vacancyId}, ${target.resumeId},
                      'submitted', 'imported', now(), now())
                    on conflict (hh_account_id, vacancy_id, resume_id) do nothing
                    returning id`)
                  const id = inserted.rows[0]?.id as string | undefined
                  if (id === undefined) return result("already", null)
                  applicationId = id
                  state = "submitted"
                } else {
                  applicationId = existing.id
                  state = existing.state
                }

                const record = () =>
                  ApplicationRepository.findAny(tx, applicationId)

                if (input.kind === "submit" && existing !== undefined) {
                  if (state === "submitted") return result("already", yield* record())
                  if (state === "submitting") return result("in_flight", yield* record())
                  if (state === "queued") {
                    // otbor's own submit may be about to click: the reconcile settles it, not this.
                    const job = yield* QueueRepository.latestFor(tx, applicationId, ["submit"])
                    if (job !== null) return result("in_flight", yield* record())
                  }
                  yield* tx.execute(sql`
                    update application
                    set state = 'submitted', submitted_at = coalesce(submitted_at, now()),
                        hh_responded_at = coalesce(hh_responded_at, now()), last_error = null, updated_at = now()
                    where id = ${applicationId} and state in ('draft', 'needs_human', 'failed', 'skipped', 'queued')`)
                }

                // What was on the form when the button was pressed is what hh holds.
                const previous = yield* ApplicationRepository.findKit(tx, applicationId)
                const formHash = blank(input.formHash) ?? previous?.formHash ?? NO_FORM
                const same = previous !== null && previous.formHash === formHash
                const answers: ReadonlyArray<KitAnswer> =
                  input.kind === "letter" ? (previous?.answers ?? []) : input.answers
                const kitLetter = input.kind === "letter" ? (letter ?? previous?.letter ?? null) : letter
                if (kitLetter !== null || answers.length > 0 || previous !== null) {
                  yield* ApplicationRepository.upsertKit(tx, {
                    userId: currentUser.userId,
                    applicationId,
                    formHash,
                    letter: kitLetter,
                    answers,
                    model: same ? (previous.model ?? null) : null,
                    promptHash: same ? (previous.promptHash ?? null) : null,
                    costUsd: same ? (previous.costUsd ?? null) : null
                  })
                }
                const unsent = blank(previous?.letter)
                if (input.kind === "submit" && letter === null && unsent !== null) {
                  // Sent without the letter the draft had: keep it as the letter to add to the response.
                  yield* tx.execute(sql`
                    insert into letter_draft (user_id, hh_account_id, vacancy_id, resume_id, letter)
                    values (${currentUser.userId}, ${target.hhAccountId}, ${vacancyId},
                            ${target.resumeId ?? NIL_RESUME}::uuid, ${unsent})
                    on conflict (user_id, hh_account_id, vacancy_id, resume_id) do nothing`)
                }
                if (input.kind === "letter" && letter !== null) {
                  // The letter is with hh now; the unsent draft of it is done.
                  yield* tx.execute(sql`
                    delete from letter_draft
                    where hh_account_id = ${target.hhAccountId} and vacancy_id = ${vacancyId}
                      and resume_id = ${target.resumeId ?? NIL_RESUME}::uuid`)
                }
                if (input.kind === "letter" && existing !== undefined && state !== "submitted") {
                  yield* tx.execute(sql`
                    update application
                    set state = 'submitted', submitted_at = coalesce(submitted_at, now()),
                        hh_responded_at = coalesce(hh_responded_at, now()), updated_at = now()
                    where id = ${applicationId} and state in ('draft', 'needs_human', 'failed', 'skipped')`)
                }
                yield* Effect.logInfo(
                  `browser ${input.kind} recorded for vacancy ${input.externalId} (application ${applicationId})`
                )
                return result("recorded", yield* record())
              })
            )
            .pipe(Effect.mapError(toStorageError("browser.recordSubmit")))
        }
      )

      return BrowserApply.of({ drafts, recordSubmit })
    })
  )
}
