import type {
  ApiError,
  HhAccountId,
  ResumeEnrichment,
  ResumeFaqEntry,
  ResumeSalary,
  ResumeId,
  ResumeRecord
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ResumeRepository from "../repositories/ResumeRepository.ts"
import * as ResumeEnrichmentRepository from "../repositories/ResumeEnrichmentRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ResumeUpsertInput {
  readonly id?: ResumeId
  readonly hhAccountId: HhAccountId
  readonly source?: string
  readonly externalId: string
  readonly title: string
  readonly text: string
  readonly about?: string
  readonly skills?: ReadonlyArray<string>
  readonly experience?: unknown
  readonly education?: unknown
  readonly workFormats?: ReadonlyArray<string>
  readonly salaryAmount?: number | null
  readonly salaryCurrency?: string | null
  readonly status?: string | null
  readonly areaName?: string | null
  readonly relocation?: string | null
  readonly businessTripReadiness?: string | null
  readonly travelTime?: string | null
  readonly englishLevel?: string | null
  readonly isActive?: boolean
  readonly lastSeenAt?: string
}

export interface ResumeServiceShape {
  readonly list: (hhAccountId?: HhAccountId) => Effect.Effect<ReadonlyArray<ResumeRecord>, ApiError>
  readonly get: (id: ResumeId) => Effect.Effect<ResumeRecord, ApiError>
  readonly upsert: (input: ResumeUpsertInput) => Effect.Effect<ResumeRecord, ApiError>
  readonly delete: (id: ResumeId) => Effect.Effect<{ readonly id: ResumeId; readonly deleted: boolean }, ApiError>
  readonly enrichmentGet: (resumeId: ResumeId) => Effect.Effect<ResumeEnrichment, ApiError>
  readonly enrichmentSave: (
    resumeId: ResumeId,
    data: {
      readonly comment?: string
      readonly currentlyEmployed?: boolean | null
      readonly salaries?: ReadonlyArray<ResumeSalary>
      readonly faq?: ReadonlyArray<ResumeFaqEntry>
      readonly experience?: ReadonlyArray<{
        readonly key: string
        readonly employmentType?: string | null
        readonly comment?: string | null
        readonly leaveReason?: string | null
      }>
    }
  ) => Effect.Effect<ResumeEnrichment, ApiError>
}

export class ResumeService extends Context.Service<ResumeService, ResumeServiceShape>()(
  "otbor/cloud/ResumeService"
) {
  static readonly layer = Layer.effect(
    ResumeService,
    Effect.gen(function* () {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: ResumeServiceShape["list"] = (hhAccountId) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ResumeRepository.list(tx, currentUser.userId, hhAccountId ?? null)
          )
          .pipe(Effect.mapError(toStorageError("resume.list")))

      const get: ResumeServiceShape["get"] = (id) =>
        Effect.gen(function* () {
          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              ResumeRepository.findById(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("resume.get")))
          if (record === null) {
            return yield* new NotFound({ entity: "resume", id: String(id) })
          }
          return record
        })

      const upsert: ResumeServiceShape["upsert"] = (input) => {
        if (input.title.trim() === "") {
          return Effect.fail(new InvalidInput({ message: "resume title must not be empty" }))
        }
        if (input.text.trim() === "") {
          return Effect.fail(new InvalidInput({ message: "resume text must not be empty" }))
        }
        return database
          .asUser(currentUser.userId, (tx) =>
            ResumeRepository.upsert(tx, {
              userId: currentUser.userId,
              id: input.id ?? null,
              hhAccountId: input.hhAccountId,
              source: input.source,
              externalId: input.externalId,
              title: input.title,
              text: input.text,
              about: input.about,
              skills: input.skills,
              experience: input.experience,
              education: input.education,
              workFormats: input.workFormats,
              salaryAmount: input.salaryAmount,
              salaryCurrency: input.salaryCurrency,
              status: input.status,
              areaName: input.areaName,
              relocation: input.relocation,
              businessTripReadiness: input.businessTripReadiness,
              travelTime: input.travelTime,
              englishLevel: input.englishLevel,
              isActive: input.isActive,
              lastSeenAt: input.lastSeenAt ?? null
            })
          )
          .pipe(Effect.mapError(toStorageError("resume.upsert")))
      }

      const del: ResumeServiceShape["delete"] = (id) =>
        Effect.gen(function* () {
          const deleted = yield* database
            .asUser(currentUser.userId, (tx) =>
              ResumeRepository.remove(tx, currentUser.userId, id)
            )
            .pipe(Effect.mapError(toStorageError("resume.delete")))
          return { id, deleted }
        })

      const enrichmentGet: ResumeServiceShape["enrichmentGet"] = (resumeId) =>
        Effect.gen(function* () {
          const existing = yield* database
            .asUser(currentUser.userId, (tx) =>
              ResumeEnrichmentRepository.get(tx, currentUser.userId, resumeId)
            )
            .pipe(Effect.mapError(toStorageError("resumeEnrichment.get")))
          if (existing !== null) return existing
          return {
            resumeId,
            comment: "",
            currentlyEmployed: null,
            salaries: [],
            faq: [],
            experience: [],
            updatedAt: null
          } as ResumeEnrichment
        })

      const enrichmentSave: ResumeServiceShape["enrichmentSave"] = (resumeId, data) =>
        database
          .asUser(currentUser.userId, (tx) =>
            ResumeEnrichmentRepository.save(tx, {
              userId: currentUser.userId,
              resumeId,
              data
            })
          )
          .pipe(Effect.mapError(toStorageError("resumeEnrichment.save")))

      return ResumeService.of({
        list,
        get,
        upsert,
        delete: del,
        enrichmentGet,
        enrichmentSave
      })
    })
  )
}