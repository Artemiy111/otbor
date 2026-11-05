import type {
  ApiError,
  HhAccountId,
  JobStatus,
  NegotiationsSyncCounts,
  NegotiationsSyncStatus
} from "@otbor/contract"
import { NegotiationsSyncCounts as NegotiationsSyncCountsSchema, NotFound } from "@otbor/contract"
import type { NegotiationTopic } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { negotiationsSyncJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

/**
 * Imports the responses an operator made by hand on hh.ru.
 *
 * `run` only enqueues a browser job: the harness reads `/applicant/negotiations`
 * and returns page HTML, `QueueService.complete` parses it with
 * `judgeNegotiationsSync` and calls `importTopics` in the completing
 * transaction. An imported application is `state = 'submitted'` with
 * `origin = 'imported'`; it exists so dedupe and the apply policy see the
 * response, and no code path ever sends anything for it.
 */

const SOURCE = "hh"
/** Unknown ids kept in the result; the count is always exact. */
const MAX_UNKNOWN_IDS = 50
const SYNC_STAGE = "negotiations_sync" as const

/** A sync that is still waiting or running is returned instead of queueing a second one. */
const ACTIVE: ReadonlyArray<JobStatus> = ["pending", "leased", "running"]

export interface ImportOutcome {
  readonly counts: NegotiationsSyncCounts
}

const parseDate = (value: string | null): Date | null => {
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The vacancy row for an external id. Only an existing row is used: the corpus
 * is written by ingest as the owner, and a completing transaction runs as the
 * user (the runtime role cannot insert vacancies). A vacancy that is not in
 * the corpus is counted and listed as unknown; once a crawl or hydration has
 * ingested it, the next sync imports it.
 */
const resolveVacancy = (tx: Executor, topic: NegotiationTopic): RepoEffect<string | null> =>
  VacancyRepository.findByExternal(tx, SOURCE, topic.vacancyId).pipe(
    Effect.map((existing) => existing?.id ?? null)
  )

/** Our resume row for the hh resume id of a topic, or null when unknown. */
const resolveResume = (
  tx: Executor,
  hhAccountId: string,
  topic: NegotiationTopic
): RepoEffect<string | null> =>
  topic.resumeId === null
    ? Effect.succeed(null)
    : tx
        .execute(
          sql`select id from resume where source = ${SOURCE} and hh_account_id = ${hhAccountId} and external_id = ${topic.resumeId} limit 1`
        )
        .pipe(Effect.map((result) => (result.rows[0]?.id as string | undefined) ?? null))

/**
 * Upserts one imported application per topic. Idempotent, and it never touches
 * a row of origin `otbor`: the conflict update is guarded by
 * `origin = 'imported'`, so an application otbor made, queued or submitted is
 * not overwritten, downgraded or re-labelled.
 */
export const importTopics = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly topics: ReadonlyArray<NegotiationTopic>
    readonly pages: number
    readonly complete: boolean
  }
): RepoEffect<ImportOutcome> =>
  Effect.gen(function*() {
    let imported = 0
    let updated = 0
    let unchanged = 0
    const unknownIds: Array<string> = []

    for (const topic of input.topics) {
      const vacancyId = yield* resolveVacancy(tx, topic)
      if (vacancyId === null) {
        unknownIds.push(topic.vacancyId)
        continue
      }
      const respondedAt = parseDate(topic.changedAt)
      const resumeId = yield* resolveResume(tx, input.hhAccountId, topic)
      if (resumeId !== null) {
        // Rows imported before the resume was known: attach it, unless that
        // resume already has its own row for the vacancy.
        yield* tx.execute(sql`
          update application a
          set resume_id = ${resumeId}, updated_at = now()
          where a.hh_account_id = ${input.hhAccountId}
            and a.vacancy_id = ${vacancyId}
            and a.origin = 'imported'
            and a.resume_id is null
            and not exists (
              select 1 from application o
              where o.hh_account_id = a.hh_account_id and o.vacancy_id = a.vacancy_id
                and o.resume_id = ${resumeId}
            )
        `)
      }
      const result = yield* tx.execute(sql`
        insert into application (user_id, hh_account_id, vacancy_id, resume_id, state, origin, hh_status, hh_responded_at)
        select ${input.userId}, ${input.hhAccountId}, ${vacancyId}, ${resumeId}, 'submitted', 'imported',
               ${topic.state}, ${respondedAt}
        -- An application otbor made itself already covers this vacancy.
        where not exists (
          select 1 from application own
          where own.hh_account_id = ${input.hhAccountId}
            and own.vacancy_id = ${vacancyId}
            and own.origin <> 'imported'
            and (own.resume_id is null or ${resumeId}::uuid is null or own.resume_id = ${resumeId}::uuid)
        )
        on conflict (hh_account_id, vacancy_id, resume_id) do update
        set hh_status = excluded.hh_status,
            hh_responded_at = excluded.hh_responded_at,
            updated_at = now()
        where application.origin = 'imported'
          and (application.hh_status is distinct from excluded.hh_status
               or application.hh_responded_at is distinct from excluded.hh_responded_at)
        returning (xmax = 0) as inserted
      `)
      const row = result.rows[0] as { inserted?: boolean } | undefined
      if (row === undefined) unchanged += 1
      else if (row.inserted === true) imported += 1
      else updated += 1
    }

    return {
      counts: {
        pages: input.pages,
        topics: input.topics.length,
        imported,
        updated,
        unchanged,
        unknownVacancy: unknownIds.length,
        unknownVacancyIds: unknownIds.slice(0, MAX_UNKNOWN_IDS),
        complete: input.complete
      }
    }
  })

const statusOf = (status: JobStatus): NegotiationsSyncStatus["status"] => {
  switch (status) {
    case "pending":
      return "pending"
    case "leased":
    case "running":
      return "running"
    case "done":
      return "done"
    case "needs_human":
    case "needs_reconcile":
      return "needs_human"
    default:
      return "failed"
  }
}

export interface NegotiationsSyncShape {
  /** Enqueues the sync and returns at once; it never waits for hh.ru. */
  readonly run: (hhAccountId: string) => Effect.Effect<NegotiationsSyncStatus, ApiError>
  /** The newest sync of the account: state and, when finished, its counts. */
  readonly status: (hhAccountId: string) => Effect.Effect<NegotiationsSyncStatus, ApiError>
}

export class NegotiationsSync extends Context.Service<NegotiationsSync, NegotiationsSyncShape>()(
  "otbor/cloud/NegotiationsSync"
) {
  static readonly layer = Layer.effect(
    NegotiationsSync,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const statusIn = (tx: Executor, hhAccountId: string) =>
        Effect.gen(function*() {
          const latest = yield* QueueRepository.latestForAccount(tx, hhAccountId, SYNC_STAGE)
          if (latest === null) {
            return { hhAccountId: hhAccountId as HhAccountId, status: "none" } as NegotiationsSyncStatus
          }
          const counts = Option.getOrNull(
            Schema.decodeUnknownOption(NegotiationsSyncCountsSchema)(
              (latest.job.result as { counts?: unknown } | null)?.counts
            )
          )
          return {
            hhAccountId: hhAccountId as HhAccountId,
            jobId: latest.job.id,
            status: statusOf(latest.job.status),
            message: latest.lastError,
            requestedAt: latest.job.createdAt,
            finishedAt: ACTIVE.includes(latest.job.status) ? null : latest.updatedAt.toISOString(),
            counts
          } satisfies NegotiationsSyncStatus
        })

      const account = (tx: Executor, hhAccountId: string) =>
        tx
          .execute(
            sql`select session_profile from hh_account where id = ${hhAccountId} and user_id = ${currentUser.userId} limit 1`
          )
          .pipe(
            Effect.map((result) =>
              result.rows[0] === undefined
                ? null
                : { sessionProfile: (result.rows[0].session_profile as string | null) ?? null }
            )
          )

      const run: NegotiationsSyncShape["run"] = (hhAccountId) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const found = yield* account(tx, hhAccountId)
              if (found === null) return null
              const latest = yield* QueueRepository.latestForAccount(tx, hhAccountId, SYNC_STAGE)
              if (latest === null || !ACTIVE.includes(latest.job.status)) {
                yield* negotiationsSyncJob(tx, {
                  userId: currentUser.userId,
                  hhAccountId,
                  sessionProfile: found.sessionProfile,
                  sequence: (yield* QueueRepository.countForAccount(tx, hhAccountId, SYNC_STAGE)) + 1
                })
              }
              return yield* statusIn(tx, hhAccountId)
            })
          )
          .pipe(
            Effect.mapError(toStorageError("negotiations.run")),
            Effect.flatMap((status) =>
              status === null
                ? Effect.fail(new NotFound({ entity: "HhAccount", id: hhAccountId }))
                : Effect.succeed(status)
            )
          )

      const status: NegotiationsSyncShape["status"] = (hhAccountId) =>
        database
          .asUser(currentUser.userId, (tx) => statusIn(tx, hhAccountId))
          .pipe(Effect.mapError(toStorageError("negotiations.status")))

      return NegotiationsSync.of({ run, status })
    })
  )
}
