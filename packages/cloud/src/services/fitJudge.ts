import type {
  ApiError,
  FitEnqueueInput,
  FitEnqueueResult,
  FitJudgement,
  FitJudgementRecord,
  FitJudgementStatus,
  FitSaveResult,
  JobStatus
} from "@otbor/contract"
import { FitJudgement as FitJudgementSchema, InvalidInput, NotFound } from "@otbor/contract"
import {
  buildFitPrompt,
  currentFitVersions,
  isFitJudgementCurrent,
  parseFitAnswer
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Effect, Predicate, Schema } from "effect"
import type { Database, Executor, RepoEffect } from "../db/Database.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as FitJudgementRepository from "../repositories/FitJudgementRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { defaultHhAccount, evaluateInTx } from "./decisionEvaluation.ts"
import { defaultResumeId, fitVacancyInput, loadResume } from "./fitInputs.ts"
import { inferenceJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

export const DEFAULT_FIT_LIMIT = 25
export const MAX_FIT_LIMIT = 200
/** Judgements waiting for a harness; a runaway enqueue cannot flood the queue. */
export const MAX_PENDING_FIT = 200
/** Below interactive writing (100) so a cover letter never waits behind a sweep. */
const FIT_JOB_PRIORITY = 50

const MAX_LIST = { reasons: 6, disqualifiers: 6, quotes: 5 } as const

/** Trims the free-text lists to the contract's caps; the numeric fields are validated as they are. */
const normalizeJudgement = (judgement: FitJudgement): FitJudgement => ({
  ...judgement,
  reasons: judgement.reasons.map((item) => item.trim()).filter((item) => item !== "").slice(0, MAX_LIST.reasons),
  disqualifiers: judgement.disqualifiers
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .slice(0, MAX_LIST.disqualifiers),
  quotes: judgement.quotes.map((item) => item.trim()).filter((item) => item !== "").slice(0, MAX_LIST.quotes)
})

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rows with `current` filled in: the vacancy's live content hash comes from
 * one query, each distinct resume's live digest hash from `loadResume`.
 */
const toRecords = (
  tx: Executor,
  userId: string,
  rows: ReadonlyArray<FitJudgementRepository.FitRow>
): RepoEffect<ReadonlyArray<FitJudgementRecord>> =>
  Effect.gen(function*() {
    if (rows.length === 0) return []

    const vacancyIds = [...new Set(rows.map((row) => row.vacancy_id))]
    const hashes = (yield* tx.execute(sql`
      select id::text as id, content_hash from vacancy
      where id in (${sql.join(vacancyIds.map((id) => sql`${id}::uuid`), sql`, `)})
    `)).rows as unknown as ReadonlyArray<{ id: string; content_hash: string }>
    const contentHashes = new Map(hashes.map((row) => [row.id, row.content_hash]))

    const resumeHashes = new Map<string, string | null>()
    for (const row of rows) {
      if (resumeHashes.has(row.resume_id)) continue
      const loaded = yield* loadResume(tx, userId, row.resume_id)
      resumeHashes.set(row.resume_id, loaded?.hash ?? null)
    }

    return rows.map((row) =>
      FitJudgementRepository.toRecord(
        row,
        isFitJudgementCurrent(
          {
            status: row.status as FitJudgementStatus,
            vacancyContentHash: row.vacancy_content_hash,
            resumeHash: row.resume_hash,
            promptVersion: row.prompt_version
          },
          {
            contentHash: contentHashes.get(row.vacancy_id) ?? "",
            resumeHash: resumeHashes.get(row.resume_id) ?? "",
            promptVersion: currentFitVersions.promptVersion
          }
        )
      )
    )
  })

/* -------------------------------------------------------------------------- */
/* Completion of an inference job                                             */
/* -------------------------------------------------------------------------- */

const resultText = (result: unknown): string | null =>
  Predicate.isObject(result) && typeof result.text === "string" ? result.text : null

const resultModel = (result: unknown): string | null =>
  Predicate.isObject(result) && typeof result.model === "string" ? result.model : null

/**
 * The completion hook for inference jobs, run inside the harness `complete`
 * transaction. If a pending judgement waits for this job it is finished
 * (parsed and stored) or marked failed, and a stored judgement immediately
 * re-decides its vacancy. Jobs that belong to something else (a cover
 * letter) have no pending row and are untouched.
 *
 * A parse failure is a value, not a defect: the job stays `done`, the
 * judgement becomes `failed` with the reason, and the next enqueue retries it.
 */
export const completeFitInference = (
  tx: Executor,
  userId: string,
  job: {
    readonly id: string
    readonly status: JobStatus
    readonly result: unknown
    readonly message: string | null
  }
): RepoEffect<void> =>
  Effect.gen(function*() {
    // `pending` means the queue scheduled a retry; the judgement keeps waiting.
    if (job.status === "pending") return

    const row = yield* FitJudgementRepository.findPendingByJob(tx, job.id)
    if (row === null) return

    if (job.status !== "done") {
      yield* FitJudgementRepository.markFailed(tx, row.id, job.message ?? `inference ${job.status}`)
      return
    }

    const text = resultText(job.result)
    if (text === null) {
      yield* FitJudgementRepository.markFailed(tx, row.id, "inference result has no text")
      return
    }

    const parsed = yield* parseFitAnswer(text).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, message: error.message }),
        onSuccess: (judgement) => ({ ok: true as const, judgement })
      })
    )
    if (!parsed.ok) {
      yield* FitJudgementRepository.markFailed(tx, row.id, parsed.message)
      return
    }

    yield* FitJudgementRepository.upsertDone(tx, {
      key: {
        userId,
        vacancyId: row.vacancy_id,
        resumeId: row.resume_id,
        vacancyContentHash: row.vacancy_content_hash,
        resumeHash: row.resume_hash,
        promptVersion: row.prompt_version
      },
      source: "llm",
      judgement: normalizeJudgement(parsed.judgement),
      model: resultModel(job.result),
      jobId: job.id
    })

    // Re-decide with the stored judgement. If the vacancy or resume changed
    // while the job ran, the judgement is not current and the evaluation just
    // keeps the deterministic fit.
    const hhAccountId = yield* defaultHhAccount(tx, userId)
    yield* evaluateInTx(
      tx,
      userId,
      { vacancyId: row.vacancy_id, resumeId: row.resume_id, hhAccountId },
      hhAccountId
    )
  })

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

export interface FitJudgeCore {
  readonly enqueue: (
    userId: string,
    input: FitEnqueueInput
  ) => Effect.Effect<FitEnqueueResult, ApiError>
  /** An externally produced judgement: same storage, same re-decision. */
  readonly save: (
    userId: string,
    input: {
      readonly vacancyId: string
      readonly resumeId?: string
      readonly judgement: FitJudgement
      readonly model?: string
    }
  ) => Effect.Effect<FitSaveResult, ApiError>
  readonly get: (
    userId: string,
    input: { readonly vacancyId: string; readonly resumeId?: string }
  ) => Effect.Effect<FitJudgementRecord | null, ApiError>
  readonly list: (
    userId: string,
    options: {
      readonly status?: FitJudgementStatus
      readonly resumeId?: string
      readonly limit?: number
      readonly offset?: number
    }
  ) => Effect.Effect<ReadonlyArray<FitJudgementRecord>, ApiError>
}

type Missing = { readonly _tag: "missing"; readonly entity: string; readonly id: string }
type NoResume = { readonly _tag: "no_resume" }

export const makeFitJudge = (database: Database["Service"]): FitJudgeCore => {
  const enqueue: FitJudgeCore["enqueue"] = (userId, input) =>
    Effect.gen(function*() {
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_FIT_LIMIT), 1), MAX_FIT_LIMIT)
      const model = input.model?.trim() === "" ? undefined : input.model?.trim()

      const outcome = yield* database
        .asUser(userId, (tx) =>
          Effect.gen(function*() {
            const resumeId = input.resumeId ?? (yield* defaultResumeId(tx, userId))
            if (resumeId === null) return { _tag: "no_resume" } as NoResume

            const resume = yield* loadResume(tx, userId, resumeId)
            if (resume === null) return { _tag: "missing", entity: "Resume", id: resumeId } as Missing

            let vacancyFilter
            if (input.presetId !== undefined) {
              const preset = yield* PresetRepository.findById(tx, input.presetId, userId)
              if (preset === null) {
                return { _tag: "missing", entity: "Preset", id: input.presetId } as Missing
              }
              vacancyFilter = LexiconRepository.vacancyFilterSql(preset.filter, { userId })
            }

            const selection: FitJudgementRepository.CandidateOptions = {
              userId,
              resumeId,
              resumeHash: resume.hash,
              promptVersion: currentFitVersions.promptVersion,
              onlyApply: input.onlyApply !== false,
              force: input.force === true,
              vacancyFilter
            }

            const inflight = yield* FitJudgementRepository.countPending(tx, userId)
            const room = Math.max(0, MAX_PENDING_FIT - inflight)
            const ids = room === 0
              ? []
              : yield* FitJudgementRepository.candidateVacancyIds(tx, {
                  ...selection,
                  limit: Math.min(limit, room)
                })

            const hhAccountId = yield* defaultHhAccount(tx, userId)
            const jobs: Array<{ vacancyId: string; jobId: string }> = []

            for (const id of ids) {
              const row = yield* VacancyRepository.findById(tx, id)
              if (row === null) continue

              const prompt = buildFitPrompt({ vacancy: fitVacancyInput(row), resume: resume.input })
              const job = yield* inferenceJob(tx, {
                userId,
                hhAccountId,
                priority: FIT_JOB_PRIORITY,
                payload: {
                  prompt: prompt.user,
                  system: prompt.system,
                  jsonSchema: prompt.jsonSchema,
                  ...(model === undefined ? {} : { model })
                },
                idempotencyKey: `fit:${userId}:${row.id}:${randomUUID()}`
              })
              yield* FitJudgementRepository.upsertPending(
                tx,
                {
                  userId,
                  vacancyId: row.id,
                  resumeId,
                  vacancyContentHash: row.contentHash,
                  resumeHash: resume.hash,
                  promptVersion: prompt.promptVersion
                },
                job.id
              )
              jobs.push({ vacancyId: row.id, jobId: job.id })
            }

            // Pending rows now count as covered, so what is left is what the
            // next call can still pick up.
            const remaining = yield* FitJudgementRepository.countCandidates(tx, selection)
            return { _tag: "ok" as const, resumeId, jobs, remaining }
          })
        )
        .pipe(Effect.mapError(toStorageError("fit.enqueue")))

      if (outcome._tag === "no_resume") {
        return yield* new InvalidInput({
          message: "no resume to judge against: import one first (otbor resume ...)"
        })
      }
      if (outcome._tag === "missing") {
        return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
      }

      return {
        resumeId: outcome.resumeId as FitEnqueueResult["resumeId"],
        enqueued: outcome.jobs.length,
        remaining: outcome.remaining,
        jobs: outcome.jobs as unknown as FitEnqueueResult["jobs"]
      }
    })

  const save: FitJudgeCore["save"] = (userId, input) =>
    Effect.gen(function*() {
      const judgement = normalizeJudgement(
        yield* Schema.decodeUnknownEffect(FitJudgementSchema)(input.judgement).pipe(
          Effect.mapError((error) => new InvalidInput({ message: `invalid judgement: ${error.message}` }))
        )
      )

      const outcome = yield* database
        .asUser(userId, (tx) =>
          Effect.gen(function*() {
            const row = yield* VacancyRepository.findById(tx, input.vacancyId)
            if (row === null) return { _tag: "missing", entity: "Vacancy", id: input.vacancyId } as Missing

            const resumeId = input.resumeId ?? (yield* defaultResumeId(tx, userId))
            if (resumeId === null) return { _tag: "no_resume" } as NoResume
            const resume = yield* loadResume(tx, userId, resumeId)
            if (resume === null) return { _tag: "missing", entity: "Resume", id: resumeId } as Missing

            const stored = yield* FitJudgementRepository.upsertDone(tx, {
              key: {
                userId,
                vacancyId: row.id,
                resumeId,
                vacancyContentHash: row.contentHash,
                resumeHash: resume.hash,
                promptVersion: currentFitVersions.promptVersion
              },
              source: "external",
              judgement,
              model: input.model?.trim() || null,
              jobId: null
            })

            const hhAccountId = yield* defaultHhAccount(tx, userId)
            const evaluated = yield* evaluateInTx(
              tx,
              userId,
              { vacancyId: row.id, resumeId, hhAccountId },
              hhAccountId
            )
            return { _tag: "ok" as const, stored, evaluated }
          })
        )
        .pipe(Effect.mapError(toStorageError("fit.save")))

      if (outcome._tag === "no_resume") {
        return yield* new InvalidInput({ message: "no resume to attach the judgement to" })
      }
      if (outcome._tag === "missing") {
        return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
      }
      if (outcome.evaluated === null) {
        return yield* new NotFound({ entity: "Vacancy", id: input.vacancyId })
      }

      const cache = outcome.evaluated.cache
      if (cache !== null) {
        yield* database
          .asOwner((tx) => DecisionRepository.cacheRulesVerdict(tx, cache))
          .pipe(Effect.mapError(toStorageError("title.cache")))
      }

      return {
        // Saved against the live inputs, so it is current by construction.
        judgement: FitJudgementRepository.toRecord(outcome.stored, true),
        decision: outcome.evaluated.record
      }
    })

  const get: FitJudgeCore["get"] = (userId, input) =>
    database
      .asUser(userId, (tx) =>
        Effect.gen(function*() {
          const rows = yield* FitJudgementRepository.listForVacancy(
            tx,
            userId,
            input.vacancyId,
            input.resumeId
          )
          const [record] = yield* toRecords(tx, userId, rows.slice(0, 1))
          return record ?? null
        })
      )
      .pipe(Effect.mapError(toStorageError("fit.get")))

  const list: FitJudgeCore["list"] = (userId, options) =>
    database
      .asUser(userId, (tx) =>
        Effect.gen(function*() {
          const rows = yield* FitJudgementRepository.list(tx, userId, options)
          return yield* toRecords(tx, userId, rows)
        })
      )
      .pipe(Effect.mapError(toStorageError("fit.list")))

  return { enqueue, save, get, list }
}
