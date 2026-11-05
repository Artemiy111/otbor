import type { ApiError, HhAccountId, JobStatus, LetterAttachStatus, LetterDraft } from "@otbor/contract"
import { Conflict, InvalidInput, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { Database, type Executor } from "../db/Database.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { letterAttachJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

/**
 * Adds a cover letter to a response hh already holds. `attach` queues one
 * browser job and returns at once; the letter is sent at most once. A letter
 * that was sent, or whose send may have reached hh, is never queued again.
 */

const STAGE = "letter_attach" as const
const ACTIVE: ReadonlyArray<JobStatus> = ["pending", "leased", "running"]

const hashOf = (letter: string): string =>
  createHash("sha256").update(letter.trim()).digest("hex").slice(0, 16)

const statusOf = (status: JobStatus): LetterAttachStatus["status"] => {
  switch (status) {
    case "pending":
      return "pending"
    case "leased":
    case "running":
      return "running"
    case "done":
      return "sent"
    case "needs_human":
    case "needs_reconcile":
      return "needs_human"
    default:
      return "failed"
  }
}

const NIL_RESUME = "00000000-0000-0000-0000-000000000000"

export interface LetterDraftKey {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId: string | null
}

export interface LetterAttachShape {
  readonly draftGet: (key: LetterDraftKey) => Effect.Effect<LetterDraft, ApiError>
  readonly draftSave: (key: LetterDraftKey & { readonly letter: string }) => Effect.Effect<LetterDraft, ApiError>
  readonly attach: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly letter: string
  }) => Effect.Effect<LetterAttachStatus, ApiError>
  readonly status: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
  }) => Effect.Effect<LetterAttachStatus, ApiError>
}

export class LetterAttach extends Context.Service<LetterAttach, LetterAttachShape>()(
  "otbor/cloud/LetterAttach"
) {
  static readonly layer = Layer.effect(
    LetterAttach,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const statusIn = (tx: Executor, hhAccountId: string, vacancyId: string) =>
        Effect.gen(function*() {
          const latest = yield* QueueRepository.latestForVacancy(tx, hhAccountId, vacancyId, STAGE)
          if (latest === null) return { status: "none", message: null, updatedAt: null, letter: null } as LetterAttachStatus
          return {
            status: statusOf(latest.job.status),
            message: latest.lastError,
            updatedAt: latest.updatedAt.toISOString(),
            letter: ((latest.job.payload as { letter?: unknown } | null)?.letter as string | undefined) ?? null
          } as LetterAttachStatus
        })

      const attach: LetterAttachShape["attach"] = (input) =>
        Effect.gen(function*() {
          const letter = input.letter.trim()
          if (letter === "") {
            return yield* Effect.fail(new InvalidInput({ message: "the cover letter is empty" }))
          }
          const result = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const vacancy = yield* VacancyRepository.findById(tx, input.vacancyId)
                const account = yield* tx.execute(
                  sql`select session_profile from hh_account where id = ${input.hhAccountId} limit 1`
                )
                if (vacancy === null) return { _tag: "missing", entity: "Vacancy", id: input.vacancyId } as const
                if (account.rows[0] === undefined) {
                  return { _tag: "missing", entity: "HhAccount", id: input.hhAccountId } as const
                }
                // hh keeps one response and one chat per resume; this job names
                // none, so with several responses it could land in the wrong chat.
                const responses = yield* tx.execute(sql`
                  select count(distinct coalesce(resume_id::text, '')) as n from application
                  where hh_account_id = ${input.hhAccountId} and vacancy_id = ${vacancy.id}
                    and state in ('submitted', 'submitting', 'queued')`)
                if (Number((responses.rows[0] as { n: number | string } | undefined)?.n ?? 0) > 1) {
                  return { _tag: "ambiguous" } as const
                }
                const latest = yield* QueueRepository.latestForVacancy(
                  tx,
                  input.hhAccountId,
                  vacancy.id,
                  STAGE
                )
                const sameLetter =
                  latest !== null &&
                  hashOf(String((latest.job.payload as { letter?: unknown } | null)?.letter ?? "")) ===
                    hashOf(letter)
                // A job in flight, or a send that happened or may have happened,
                // is returned as it is: never a second send.
                const blocked =
                  latest !== null &&
                  (ACTIVE.includes(latest.job.status) ||
                    (sameLetter && ["done", "needs_human", "needs_reconcile"].includes(latest.job.status)))
                if (!blocked) {
                  yield* letterAttachJob(tx, {
                    userId: currentUser.userId,
                    hhAccountId: input.hhAccountId,
                    vacancyId: vacancy.id,
                    externalId: vacancy.externalId,
                    canonicalUrl: vacancy.canonicalUrl,
                    sessionProfile: (account.rows[0].session_profile as string | null) ?? null,
                    letter,
                    letterHash: hashOf(letter),
                    sequence:
                      (yield* QueueRepository.countForVacancy(tx, input.hhAccountId, vacancy.id, STAGE)) + 1
                  })
                }
                return { _tag: "ok", status: yield* statusIn(tx, input.hhAccountId, vacancy.id) } as const
              })
            )
            .pipe(Effect.mapError(toStorageError("letter.attach")))
          if (result._tag === "ambiguous") {
            return yield* Effect.fail(
              new Conflict({
                entity: "LetterAttach",
                message: "several responses (resumes) exist for this vacancy; the letter cannot pick the right chat yet"
              })
            )
          }
          return result._tag === "missing"
            ? yield* Effect.fail(new NotFound({ entity: result.entity, id: result.id }))
            : result.status
        })

      const status: LetterAttachShape["status"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) => statusIn(tx, input.hhAccountId, input.vacancyId))
          .pipe(Effect.mapError(toStorageError("letter.status")))

      const draftGet: LetterAttachShape["draftGet"] = (key) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const result = yield* tx.execute(sql`
                select letter, updated_at from letter_draft
                where hh_account_id = ${key.hhAccountId} and vacancy_id = ${key.vacancyId}
                  and resume_id = ${key.resumeId ?? NIL_RESUME}::uuid
                limit 1`)
              const row = result.rows[0] as { letter: string; updated_at: Date | string } | undefined
              return row === undefined
                ? ({ letter: null, updatedAt: null } satisfies LetterDraft)
                : ({ letter: row.letter, updatedAt: new Date(row.updated_at).toISOString() } satisfies LetterDraft)
            })
          )
          .pipe(Effect.mapError(toStorageError("letter.draftGet")))

      const draftSave: LetterAttachShape["draftSave"] = (key) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const letter = key.letter.trim()
              if (letter === "") {
                yield* tx.execute(sql`
                  delete from letter_draft
                  where hh_account_id = ${key.hhAccountId} and vacancy_id = ${key.vacancyId}
                    and resume_id = ${key.resumeId ?? NIL_RESUME}::uuid`)
                return { letter: null, updatedAt: null } satisfies LetterDraft
              }
              const result = yield* tx.execute(sql`
                insert into letter_draft (user_id, hh_account_id, vacancy_id, resume_id, letter)
                values (${currentUser.userId}, ${key.hhAccountId}, ${key.vacancyId},
                        ${key.resumeId ?? NIL_RESUME}::uuid, ${letter})
                on conflict (user_id, hh_account_id, vacancy_id, resume_id)
                do update set letter = excluded.letter, updated_at = now()
                returning updated_at`)
              const row = result.rows[0] as { updated_at: Date | string }
              return { letter, updatedAt: new Date(row.updated_at).toISOString() } satisfies LetterDraft
            })
          )
          .pipe(Effect.mapError(toStorageError("letter.draftSave")))

      return LetterAttach.of({ attach, status, draftGet, draftSave })
    })
  )
}
