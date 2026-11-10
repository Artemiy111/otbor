import type {
  ApiError,
  BlacklistRecord,
  BlacklistScope,
  BlacklistTarget
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as BlacklistRepository from "../repositories/BlacklistRepository.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as ResumeRepository from "../repositories/ResumeRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { sql } from "drizzle-orm"
import { evaluateInTx } from "./decisionEvaluation.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface BlacklistServiceShape {
  readonly list: (filter: BlacklistRepository.BlacklistFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<BlacklistRecord>; readonly total: number },
    ApiError
  >
  readonly upsert: (input: {
    readonly id?: string
    readonly scope: BlacklistScope
    readonly hhAccountId?: string
    readonly resumeId?: string
    readonly targetType: BlacklistTarget
    readonly externalId: string
    readonly name?: string
    readonly reason?: string
  }) => Effect.Effect<BlacklistRecord, ApiError>
  readonly remove: (id: string) => Effect.Effect<boolean, ApiError>
  readonly rejectVacancy: (input: {
    readonly vacancyId: string
    readonly scope: BlacklistRepository.RejectScope
    readonly hhAccountId?: string
    readonly resumeId?: string
    readonly reason?: string
  }) => Effect.Effect<
    { readonly rejection: BlacklistRecord; readonly skippedApplications: number },
    ApiError
  >
  readonly rejections: (vacancyId: string) => Effect.Effect<ReadonlyArray<BlacklistRecord>, ApiError>
  readonly unrejectVacancy: (id: string) => Effect.Effect<boolean, ApiError>
  readonly importHh: (input: {
    readonly hhAccountId: string
    readonly entries: ReadonlyArray<{
      readonly targetType: BlacklistTarget
      readonly externalId: string
      readonly name?: string
    }>
  }) => Effect.Effect<
    { readonly imported: number; readonly updated: number; readonly skipped: number },
    ApiError
  >
}

const accountExists = (tx: Executor, userId: string, accountId: string) =>
  HhAccountRepository.find(tx, userId, accountId).pipe(Effect.map((row) => row !== null))

/** Состояния заявки, которые отбраковка ещё может остановить. */
const STOPPABLE = ["draft", "preparing", "needs_human", "queued"] as const

/**
 * Пары (аккаунт, резюме), для которых решение вакансии зависит от отбраковки
 * этого слоя: их нужно пересчитать, чтобы решение показало причину (или
 * вернулось к обычному после снятия).
 */
const reevaluate = (
  tx: Executor,
  userId: string,
  input: {
    readonly vacancyIds: ReadonlyArray<string>
    readonly scope: BlacklistRepository.RejectScope
    readonly hhAccountId: string | null
    readonly resumeId: string | null
  }
) =>
  Effect.gen(function*() {
    const scopes = yield* DecisionRepository.evaluationScopes(tx, userId, {
      hhAccountId: input.scope === "app" ? undefined : input.hhAccountId,
      resumeId: input.scope === "resume" ? input.resumeId : undefined
    })
    for (const vacancyId of input.vacancyIds) {
      for (const pair of scopes) {
        yield* evaluateInTx(
          tx,
          userId,
          { vacancyId, resumeId: pair.resumeId, hhAccountId: pair.hhAccountId },
          pair.hhAccountId
        )
      }
    }
  })

/**
 * Переводит неотправленные заявки вакансии в `skipped`. `submitting` и
 * отправленные не трогаем: отправка at-most-once, итог решает reconcile. Из
 * `queued` забираем только ту, чью submit-задачу ещё не взял харнесс.
 */
const skipApplications = (
  tx: Executor,
  userId: string,
  input: {
    readonly vacancyId: string
    readonly scope: BlacklistRepository.RejectScope
    readonly hhAccountId: string | null
    readonly resumeId: string | null
  }
) =>
  Effect.gen(function*() {
    const scopeClause = input.scope === "app"
      ? sql`true`
      : input.scope === "hh_account"
      ? sql`hh_account_id = ${input.hhAccountId}::uuid`
      : sql`resume_id = ${input.resumeId}::uuid`
    const found = yield* tx.execute(sql`
      select id::text as id, state from application
      where user_id = ${userId} and vacancy_id = ${input.vacancyId}::uuid
        and state in (${sql.join(STOPPABLE.map((state) => sql`${state}`), sql`, `)})
        and ${scopeClause}
    `)
    let skipped = 0
    for (const row of found.rows as unknown as ReadonlyArray<{ id: string; state: typeof STOPPABLE[number] }>) {
      const cancelled = yield* QueueRepository.cancelForApplication(tx, row.id)
      if (row.state === "queued" && cancelled === 0) continue
      const updated = yield* ApplicationRepository.transition(tx, userId, row.id, "skipped", {
        from: [row.state],
        patch: { lastError: `rejected (${input.scope})` }
      })
      if (updated !== null) skipped += 1
    }
    return skipped
  })

export class BlacklistService extends Context.Service<BlacklistService, BlacklistServiceShape>()(
  "otbor/cloud/BlacklistService"
) {
  static readonly layer = Layer.effect(
    BlacklistService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const list: BlacklistServiceShape["list"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) => BlacklistRepository.list(tx, filter))
          .pipe(Effect.mapError(toStorageError("blacklist.list")))

      const upsert: BlacklistServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const invalid = BlacklistRepository.validateInput({
            scope: input.scope,
            hhAccountId: input.hhAccountId,
            resumeId: input.resumeId,
            targetType: input.targetType,
            externalId: input.externalId
          })
          if (invalid !== null) {
            return yield* new InvalidInput({ message: invalid })
          }

          const record = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (input.scope === "resume") {
                  // Резюме должно принадлежать пользователю, иначе чужой id не отличить от своего.
                  const resume = yield* ResumeRepository.find(tx, currentUser.userId, input.resumeId!)
                  if (resume === null) return { _tag: "missing" as const, entity: "Resume", id: input.resumeId! }
                } else if (input.scope !== "app" && input.hhAccountId !== undefined) {
                  const exists = yield* accountExists(
                    tx,
                    currentUser.userId,
                    input.hhAccountId
                  )
                  if (!exists) return { _tag: "missing" as const, entity: "HhAccount", id: input.hhAccountId }
                }
                const saved = yield* BlacklistRepository.upsert(tx, {
                  userId: currentUser.userId,
                  id: input.id,
                  scope: input.scope,
                  hhAccountId: input.scope === "app" || input.scope === "resume" ? null : input.hhAccountId ?? null,
                  resumeId: input.scope === "resume" ? input.resumeId ?? null : null,
                  targetType: input.targetType,
                  externalId: input.externalId,
                  name: input.name ?? null,
                  reason: input.reason ?? null
                })
                return { _tag: "ok" as const, record: saved }
              })
            )
            .pipe(Effect.mapError(toStorageError("blacklist.upsert")))

          if (record._tag === "missing") {
            return yield* new NotFound({ entity: record.entity, id: record.id })
          }
          return record.record
        })

      const remove: BlacklistServiceShape["remove"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) => BlacklistRepository.remove(tx, id))
          .pipe(Effect.mapError(toStorageError("blacklist.remove")))

      const importHh: BlacklistServiceShape["importHh"] = (input) =>
        Effect.gen(function*() {
          const result = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const exists = yield* accountExists(tx, currentUser.userId, input.hhAccountId)
                if (!exists) return null
                return yield* BlacklistRepository.importHh(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  entries: input.entries
                })
              })
            )
            .pipe(Effect.mapError(toStorageError("blacklist.importHh")))

          if (result === null) {
            return yield* new NotFound({ entity: "HhAccount", id: input.hhAccountId })
          }
          return result
        })

      const rejectVacancy: BlacklistServiceShape["rejectVacancy"] = (input) =>
        Effect.gen(function*() {
          if (input.scope === "hh_account" && input.hhAccountId === undefined) {
            return yield* new InvalidInput({ message: "hh_account scope requires hhAccountId" })
          }
          if (input.scope === "resume" && input.resumeId === undefined) {
            return yield* new InvalidInput({ message: "resume scope requires resumeId" })
          }
          const userId = currentUser.userId

          const result = yield* database
            .asUser(userId, (tx) =>
              Effect.gen(function*() {
                const vacancy = yield* VacancyRepository.findById(tx, input.vacancyId)
                if (vacancy === null) return { _tag: "missing" as const, entity: "Vacancy", id: input.vacancyId }

                let hhAccountId: string | null = null
                let resumeId: string | null = null
                if (input.scope === "hh_account") {
                  const account = yield* HhAccountRepository.find(tx, userId, input.hhAccountId!)
                  if (account === null) return { _tag: "missing" as const, entity: "HhAccount", id: input.hhAccountId! }
                  hhAccountId = input.hhAccountId!
                }
                if (input.scope === "resume") {
                  const resume = yield* ResumeRepository.find(tx, userId, input.resumeId!)
                  if (resume === null) return { _tag: "missing" as const, entity: "Resume", id: input.resumeId! }
                  resumeId = input.resumeId!
                  hhAccountId = resume.hh_account_id
                }

                const rejection = yield* BlacklistRepository.reject(tx, {
                  userId,
                  vacancyExternalId: vacancy.externalId,
                  name: vacancy.title,
                  scope: input.scope,
                  hhAccountId: input.scope === "hh_account" ? hhAccountId : null,
                  resumeId,
                  reason: input.reason?.trim() === "" ? null : input.reason?.trim() ?? null
                })
                const skippedApplications = yield* skipApplications(tx, userId, {
                  vacancyId: vacancy.id,
                  scope: input.scope,
                  hhAccountId,
                  resumeId
                })
                yield* reevaluate(tx, userId, {
                  vacancyIds: [vacancy.id],
                  scope: input.scope,
                  hhAccountId,
                  resumeId
                })
                return { _tag: "ok" as const, rejection, skippedApplications }
              })
            )
            .pipe(Effect.mapError(toStorageError("blacklist.rejectVacancy")))

          if (result._tag === "missing") {
            return yield* new NotFound({ entity: result.entity, id: result.id })
          }
          return { rejection: result.rejection, skippedApplications: result.skippedApplications }
        })

      const rejections: BlacklistServiceShape["rejections"] = (vacancyId) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const vacancy = yield* VacancyRepository.findById(tx, vacancyId)
              if (vacancy === null) return []
              return yield* BlacklistRepository.rejectionsFor(tx, currentUser.userId, vacancy.externalId)
            })
          )
          .pipe(Effect.mapError(toStorageError("blacklist.rejections")))

      const unrejectVacancy: BlacklistServiceShape["unrejectVacancy"] = (id) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const record = yield* BlacklistRepository.findById(tx, id)
              if (record === null || record.targetType !== "vacancy") return false
              if (record.scope !== "app" && record.scope !== "hh_account" && record.scope !== "resume") {
                return false
              }
              const removed = yield* BlacklistRepository.remove(tx, id)
              if (!removed) return false

              // Решения вакансии заново: снятая отбраковка больше не причина skip.
              const vacancies = yield* tx.execute(sql`
                select id::text as id from vacancy where external_id = ${record.externalId}
              `)
              let resumeAccount: string | null = record.hhAccountId ?? null
              if (record.scope === "resume" && record.resumeId !== null && record.resumeId !== undefined) {
                const resume = yield* ResumeRepository.find(tx, currentUser.userId, record.resumeId)
                resumeAccount = resume?.hh_account_id ?? null
              }
              const vacancyIds = (vacancies.rows as unknown as ReadonlyArray<{ id: string }>).map((row) => row.id)

              // Заявки, которые остановила сама отбраковка, возвращаются
              // черновиками: пропущенная заявка иначе считалась бы «уже откликались».
              if (vacancyIds.length > 0) {
                const scopeClause = record.scope === "app"
                  ? sql`true`
                  : record.scope === "hh_account"
                  ? sql`hh_account_id = ${record.hhAccountId ?? null}::uuid`
                  : sql`resume_id = ${record.resumeId ?? null}::uuid`
                yield* tx.execute(sql`
                  update application
                  set state = 'draft', last_error = null, blocked_reason = null, retry_at = null, updated_at = now()
                  where user_id = ${currentUser.userId}
                    and vacancy_id in (${sql.join(vacancyIds.map((id) => sql`${id}::uuid`), sql`, `)})
                    and state = 'skipped' and last_error like 'rejected (%'
                    and ${scopeClause}
                `)
              }
              yield* reevaluate(tx, currentUser.userId, {
                vacancyIds,
                scope: record.scope,
                hhAccountId: resumeAccount,
                resumeId: record.resumeId ?? null
              })
              return true
            })
          )
          .pipe(Effect.mapError(toStorageError("blacklist.unrejectVacancy")))

      return BlacklistService.of({
        list,
        upsert,
        remove,
        importHh,
        rejectVacancy,
        rejections,
        unrejectVacancy
      })
    })
  )
}
