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

/** Domain errors raised inside a transaction pass through; a driver failure becomes a storage error. */
const keepApiError =
  (operation: string) =>
  (error: unknown): ApiError =>
    error instanceof Conflict || error instanceof NotFound ? error : toStorageError(operation)(error)

const NIL_RESUME = "00000000-0000-0000-0000-000000000000"

export interface LetterDraftKey {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId: string | null
}

/**
 * Which response a letter goes to. hh keeps one response, and one chat, per
 * resume, so with several responses the resume must name one and its chat must
 * be known (`otbor hh sync` records it). A single response may still use the
 * vacancy page when no chat is known yet.
 */
const targetIn = Effect.fnUntraced(function*(
  tx: Executor,
  hhAccountId: string,
  vacancyId: string,
  resumeId: string | null
) {
  const result = yield* tx.execute(sql`
    select resume_id::text as resume_id, hh_chat_id, hh_status from application
    where hh_account_id = ${hhAccountId} and vacancy_id = ${vacancyId}
      and state in ('submitted', 'submitting', 'queued')`)
  const rows = result.rows as ReadonlyArray<{
    resume_id: string | null
    hh_chat_id: string | null
    hh_status: string | null
  }>
  if (rows.length === 0) return null
  const row =
    resumeId !== null
      ? (rows.find((item) => item.resume_id === resumeId) ?? (rows.length === 1 ? rows[0] : undefined))
      : rows.length === 1
        ? rows[0]
        : undefined
  if (row === undefined) {
    return yield* new Conflict({
      entity: "LetterAttach",
      message:
        resumeId === null
          ? "several responses (resumes) exist for this vacancy; name the resume to choose the chat"
          : "there is no response to this vacancy with that resume"
    })
  }
  if (row.hh_status === "DISCARD") {
    return yield* new Conflict({
      entity: "LetterAttach",
      message: "the employer declined this response; its chat takes no cover letter"
    })
  }
  if (row.hh_chat_id === null && rows.length > 1) {
    return yield* new Conflict({
      entity: "LetterAttach",
      message: "the chat of this response is not known yet; run `otbor hh sync` first"
    })
  }
  return row.hh_chat_id
})

export interface LetterAttachShape {
  readonly draftGet: (key: LetterDraftKey) => Effect.Effect<LetterDraft, ApiError>
  readonly draftSave: (key: LetterDraftKey & { readonly letter: string }) => Effect.Effect<LetterDraft, ApiError>
  readonly attach: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string | null
    readonly letter: string
  }) => Effect.Effect<LetterAttachStatus, ApiError>
  readonly status: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string | null
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

      const statusIn = (tx: Executor, hhAccountId: string, vacancyId: string, chatId: string | null) =>
        Effect.gen(function*() {
          const latest = yield* QueueRepository.latestForVacancy(tx, hhAccountId, vacancyId, STAGE, chatId)
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
                if (vacancy === null) return yield* new NotFound({ entity: "Vacancy", id: input.vacancyId })
                if (account.rows[0] === undefined) {
                  return yield* new NotFound({ entity: "HhAccount", id: input.hhAccountId })
                }
                const chatId = yield* targetIn(tx, input.hhAccountId, vacancy.id, input.resumeId ?? null)
                const latest = yield* QueueRepository.latestForVacancy(
                  tx,
                  input.hhAccountId,
                  vacancy.id,
                  STAGE,
                  chatId
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
                    chatId,
                    sequence:
                      (yield* QueueRepository.countForVacancy(
                        tx,
                        input.hhAccountId,
                        vacancy.id,
                        STAGE,
                        chatId
                      )) + 1
                  })
                }
                return yield* statusIn(tx, input.hhAccountId, vacancy.id, chatId)
              })
            )
            .pipe(Effect.mapError(keepApiError("letter.attach")))
          return result
        })

      const status: LetterAttachShape["status"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              // A conflict has nothing to report: no job can exist for an unnamed response.
              const chatId = yield* targetIn(tx, input.hhAccountId, input.vacancyId, input.resumeId ?? null).pipe(
                Effect.catchTag("Conflict", () => Effect.succeed(null))
              )
              return yield* statusIn(tx, input.hhAccountId, input.vacancyId, chatId)
            })
          )
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
