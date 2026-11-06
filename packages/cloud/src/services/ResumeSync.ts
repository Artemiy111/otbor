import type {
  ApiError,
  HhAccountId,
  JobStatus,
  ResumeSyncCounts,
  ResumeSyncStatus
} from "@otbor/contract"
import { Conflict, NotFound, ResumeSyncCounts as ResumeSyncCountsSchema } from "@otbor/contract"
import { type ParsedResume, resumeExperienceKey } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as ResumeRepository from "../repositories/ResumeRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { resumeSyncJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

/**
 * Loads the account's own resumes from hh.ru into the corpus.
 *
 * `run` only enqueues a browser job: the harness opens the profile page and
 * each resume page and returns their HTML, `QueueService.complete` parses it
 * with `judgeResumeSync` and calls `importResumes` in the completing
 * transaction. The operator's enrichment hangs off the resume id, which an
 * update keeps, so it survives every re-import.
 */

const SOURCE = "hh"
const SYNC_STAGE = "resume_sync" as const

/** A sync that is still waiting or running is returned instead of queueing a second one. */
const ACTIVE: ReadonlyArray<JobStatus> = ["pending", "leased", "running"]

/** jsonb does not keep key order, so objects are compared with sorted keys. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  )

const sameJson = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

/**
 * Upserts one resume per card. A resume whose content did not change is left
 * alone apart from `last_seen_at`. A new resume becomes the account's active
 * one only when the account has none yet; an existing choice is never changed.
 * Stored hh resumes missing from a fully read profile are marked inactive.
 */
export const importResumes = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly found: number
    readonly resumes: ReadonlyArray<ParsedResume>
    readonly unreadable: number
    readonly now?: Date
  }
): RepoEffect<ResumeSyncCounts> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    let imported = 0
    let updated = 0
    let unchanged = 0

    for (const parsed of input.resumes) {
      const existing = yield* ResumeRepository.findBySourceExternal(tx, input.userId, SOURCE, parsed.externalId)
      const experience = parsed.experience.map((item) => ({ ...item, key: resumeExperienceKey(item) }))
      const education = parsed.education

      if (existing === null) {
        const active = yield* tx.execute(
          sql`select 1 from resume where user_id = ${input.userId} and hh_account_id = ${input.hhAccountId}::uuid and is_active limit 1`
        )
        yield* ResumeRepository.upsert(tx, {
          userId: input.userId,
          hhAccountId: input.hhAccountId,
          source: SOURCE,
          externalId: parsed.externalId,
          title: parsed.title,
          text: parsed.text,
          about: parsed.about,
          skills: parsed.skills,
          experience,
          education,
          workFormats: parsed.workFormats,
          salaryAmount: parsed.salaryAmount === null ? null : Math.trunc(parsed.salaryAmount),
          salaryCurrency: parsed.salaryCurrency,
          status: parsed.status,
          areaName: parsed.areaName,
          relocation: parsed.relocation,
          businessTripReadiness: parsed.businessTripReadiness,
          travelTime: parsed.travelTime,
          englishLevel: parsed.englishLevel,
          isActive: active.rows.length === 0,
          lastSeenAt: now,
          now
        })
        imported += 1
        continue
      }

      const changed =
        existing.hh_account_id !== input.hhAccountId ||
        existing.title !== parsed.title ||
        existing.text !== parsed.text ||
        existing.about !== parsed.about ||
        existing.status !== parsed.status ||
        existing.area_name !== parsed.areaName ||
        existing.relocation !== parsed.relocation ||
        existing.business_trip_readiness !== parsed.businessTripReadiness ||
        existing.travel_time !== parsed.travelTime ||
        existing.english_level !== parsed.englishLevel ||
        existing.salary_amount !== (parsed.salaryAmount === null ? null : Math.trunc(parsed.salaryAmount)) ||
        existing.salary_currency !== parsed.salaryCurrency ||
        !sameJson(existing.skills, parsed.skills) ||
        !sameJson(existing.work_formats, parsed.workFormats) ||
        !sameJson(existing.experience, experience) ||
        !sameJson(existing.education, education)

      if (!changed) {
        yield* tx.execute(sql`update resume set last_seen_at = ${now} where id = ${existing.id}::uuid`)
        unchanged += 1
        continue
      }
      yield* ResumeRepository.upsert(tx, {
        userId: input.userId,
        id: existing.id,
        hhAccountId: input.hhAccountId,
        source: SOURCE,
        externalId: parsed.externalId,
        title: parsed.title,
        text: parsed.text,
        about: parsed.about,
        skills: parsed.skills,
        experience,
        education,
        workFormats: parsed.workFormats,
        salaryAmount: parsed.salaryAmount === null ? null : Math.trunc(parsed.salaryAmount),
        salaryCurrency: parsed.salaryCurrency,
        status: parsed.status,
        areaName: parsed.areaName,
        relocation: parsed.relocation,
        businessTripReadiness: parsed.businessTripReadiness,
        travelTime: parsed.travelTime,
        englishLevel: parsed.englishLevel,
        // The operator's choice of the active resume is not the sync's to change.
        isActive: existing.is_active,
        lastSeenAt: now,
        now
      })
      updated += 1
    }

    let deactivated = 0
    if (input.unreadable === 0 && input.resumes.length > 0) {
      const seen = input.resumes.map((resume) => resume.externalId)
      const result = yield* tx.execute(sql`
        update resume set is_active = false, updated_at = ${now}
        where user_id = ${input.userId}
          and hh_account_id = ${input.hhAccountId}::uuid
          and source = ${SOURCE}
          and is_active
          and external_id not in (${sql.join(seen.map((id) => sql`${id}`), sql`, `)})
        returning id
      `)
      deactivated = result.rows.length
    }

    // Deactivating the stale ones must not leave the account without an active resume.
    if (input.resumes.length > 0) {
      yield* tx.execute(sql`
        update resume set is_active = true, updated_at = ${now}
        where id = (
          select id from resume
          where user_id = ${input.userId} and hh_account_id = ${input.hhAccountId}::uuid and source = ${SOURCE}
          order by last_seen_at desc, created_at desc limit 1
        )
        and not exists (
          select 1 from resume
          where user_id = ${input.userId} and hh_account_id = ${input.hhAccountId}::uuid and is_active
        )
      `)
    }

    return { found: input.found, imported, updated, unchanged, unreadable: input.unreadable, deactivated }
  })

const statusOf = (status: JobStatus): ResumeSyncStatus["status"] => {
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

export interface ResumeSyncShape {
  /** Enqueues the sync for the current user's account and returns at once. */
  readonly run: (hhAccountId: string) => Effect.Effect<ResumeSyncStatus, ApiError>
  /** The newest sync of the account: state and, when finished, its counts. */
  readonly status: (hhAccountId: string) => Effect.Effect<ResumeSyncStatus, ApiError>
  /**
   * Enqueues the sync for one account of `userId`, or for every account when
   * `target` is `global`. For the schedule worker, which has no request user.
   */
  readonly enqueue: (
    userId: string,
    target: string
  ) => Effect.Effect<{ readonly queued: number; readonly alreadyActive: number }, ApiError>
}

export class ResumeSync extends Context.Service<ResumeSync, ResumeSyncShape>()(
  "otbor/cloud/ResumeSync"
) {
  static readonly layer = Layer.effect(
    ResumeSync,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const statusIn = (tx: Executor, hhAccountId: string) =>
        Effect.gen(function*() {
          const latest = yield* QueueRepository.latestForAccount(tx, hhAccountId, SYNC_STAGE)
          if (latest === null) {
            return { hhAccountId: hhAccountId as HhAccountId, status: "none" } as ResumeSyncStatus
          }
          const counts = Option.getOrNull(
            Schema.decodeUnknownOption(ResumeSyncCountsSchema)(
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
          } satisfies ResumeSyncStatus
        })

      const account = (tx: Executor, userId: string, hhAccountId: string) =>
        tx
          .execute(
            sql`select session_profile from hh_account where id = ${hhAccountId} and user_id = ${userId} limit 1`
          )
          .pipe(
            Effect.map((result) =>
              result.rows[0] === undefined
                ? null
                : { sessionProfile: (result.rows[0].session_profile as string | null) ?? null }
            )
          )

      /** Enqueues unless a sync is already waiting. `null` when the account is not the user's. */
      const queueIn = (tx: Executor, userId: string, hhAccountId: string, requireHarness = false) =>
        Effect.gen(function*() {
          const found = yield* account(tx, userId, hhAccountId)
          if (found === null) return null
          // A manual sync with no running browser harness would wait forever; say so now.
          // Scheduled syncs may queue anyway: the job waits for the harness.
          if (requireHarness) {
            const running = (yield* HarnessRepository.statusList(tx)).some(
              (h) => h.online && h.kinds.includes("browser") && h.accounts.includes(hhAccountId)
            )
            if (!running) return "offline" as const
          }
          const latest = yield* QueueRepository.latestForAccount(tx, hhAccountId, SYNC_STAGE)
          if (latest !== null && ACTIVE.includes(latest.job.status)) return "active" as const
          yield* resumeSyncJob(tx, {
            userId,
            hhAccountId,
            sessionProfile: found.sessionProfile,
            sequence: (yield* QueueRepository.countForAccount(tx, hhAccountId, SYNC_STAGE)) + 1
          })
          return "queued" as const
        })

      const run: ResumeSyncShape["run"] = (hhAccountId) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const queued = yield* queueIn(tx, currentUser.userId, hhAccountId, true)
              if (queued === null) return null
              if (queued === "offline") return "offline" as const
              return yield* statusIn(tx, hhAccountId)
            })
          )
          .pipe(
            Effect.mapError(toStorageError("resume.sync.run")),
            Effect.flatMap((status) =>
              Effect.gen(function*() {
                if (status === null) return yield* new NotFound({ entity: "HhAccount", id: hhAccountId })
                if (status === "offline") {
                  return yield* new Conflict({
                    entity: "harness",
                    message:
                      "Браузерный harness этого аккаунта не запущен. Запустите `otbor harness run` (или `otbor up --harness`) и повторите."
                  })
                }
                return status
              })
            )
          )

      const status: ResumeSyncShape["status"] = (hhAccountId) =>
        database
          .asUser(currentUser.userId, (tx) => statusIn(tx, hhAccountId))
          .pipe(Effect.mapError(toStorageError("resume.sync.status")))

      const enqueue: ResumeSyncShape["enqueue"] = (userId, target) =>
        database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              const named = target.trim() !== "" && target.trim() !== "global"
              const accounts = named
                ? [target.trim()]
                : (yield* tx.execute(sql`select id::text as id from hh_account where user_id = ${userId}`)).rows.map(
                    (row) => (row as { id: string }).id
                  )
              let queued = 0
              let alreadyActive = 0
              for (const id of accounts) {
                const result = yield* queueIn(tx, userId, id)
                if (result === "queued") queued += 1
                else if (result === "active") alreadyActive += 1
              }
              return { queued, alreadyActive }
            })
          )
          .pipe(Effect.mapError(toStorageError("resume.sync.enqueue")))

      return ResumeSync.of({ run, status, enqueue })
    })
  )
}
