import type { ApiError, HhAccountId, JobStatus, LetterAttachStatus } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
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

export interface LetterAttachShape {
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
          return result._tag === "missing"
            ? yield* Effect.fail(new NotFound({ entity: result.entity, id: result.id }))
            : result.status
        })

      const status: LetterAttachShape["status"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) => statusIn(tx, input.hhAccountId, input.vacancyId))
          .pipe(Effect.mapError(toStorageError("letter.status")))

      return LetterAttach.of({ attach, status })
    })
  )
}
