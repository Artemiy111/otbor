import type { ApiError, ApplicationRecord, HarnessJob } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { Database, type DatabaseError, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import {
  buildDraftPrompt,
  buildAnswersPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  type CoverLetterLength,
  type VacancyContext,
  type WritingLanguageOption,
  type WritingPrompt
} from "../writing/prompts.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { inferenceJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface CoverLetterInput {
  readonly applicationId: string
  readonly tone?: string
  readonly length?: CoverLetterLength
  readonly language?: WritingLanguageOption
  readonly model?: string
}

export interface AnswersInput {
  readonly applicationId: string
  readonly questions: ReadonlyArray<string>
  readonly language?: WritingLanguageOption
  readonly model?: string
}

export interface DraftInput {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  readonly harness: string
  readonly model?: string
  readonly effort?: string
  readonly language?: WritingLanguageOption
}

export interface ResumeInput {
  readonly text: string
  readonly targetRole?: string
  readonly language?: WritingLanguageOption
  readonly model?: string
}

export interface WritingServiceShape {
  readonly coverLetter: (
    input: CoverLetterInput
  ) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  readonly answers: (input: AnswersInput) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  readonly resume: (input: ResumeInput) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  /** Cover letter and employer-test answers of a vacancy in one model call. No application needed. */
  readonly draft: (input: DraftInput) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

interface ApplicationContext {
  readonly application: ApplicationRecord
  readonly vacancy: VacancyRepository.VacancyRow
  readonly resumeText: string | null
}

type Missing = {
  readonly _tag: "missing"
  readonly entity: string
  readonly id: string
}

type Loaded = { readonly _tag: "ok"; readonly context: ApplicationContext } | Missing

const missing = (entity: string, id: string): Missing => ({ _tag: "missing", entity, id })

const resumeTextFor = (
  tx: Executor,
  userId: string,
  resumeId: string
): Effect.Effect<string | null, DatabaseError> =>
  tx
    .execute(sql`select text from resume where id = ${resumeId} and user_id = ${userId} limit 1`)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as { text?: string } | undefined
        return row?.text ?? null
      })
    )

/**
 * Everything a writing prompt needs, loaded in one user-scoped transaction.
 * A resume is optional on an application; a dangling resume id is not.
 */
const loadApplicationContext = (
  tx: Executor,
  userId: string,
  applicationId: string
): Effect.Effect<Loaded, DatabaseError> =>
  Effect.gen(function*() {
    const application = yield* ApplicationRepository.findAny(tx, applicationId)
    if (application === null || application.userId !== userId) {
      return missing("Application", applicationId)
    }

    const vacancy = yield* VacancyRepository.findById(tx, application.vacancyId)
    if (vacancy === null) {
      return missing("Vacancy", application.vacancyId)
    }

    const resumeId = application.resumeId ?? null
    const resumeText = resumeId === null ? null : yield* resumeTextFor(tx, userId, resumeId)
    if (resumeId !== null && resumeText === null) {
      return missing("Resume", resumeId)
    }

    return { _tag: "ok" as const, context: { application, vacancy, resumeText } }
  })

const vacancyContext = (vacancy: VacancyRepository.VacancyRow): VacancyContext => ({
  title: vacancy.title,
  employer: vacancy.employerName,
  description: vacancy.descriptionText,
  skills: vacancy.skills
})

/** The account an application-free job (a resume rewrite) belongs to. */
const accountFor = (tx: Executor, userId: string) =>
  tx
    .execute(sql`
      select id from hh_account
      where user_id = ${userId}
      order by is_default desc, created_at asc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

const modelOf = (model: string | undefined): string | undefined => {
  const trimmed = model?.trim() ?? ""
  return trimmed === "" ? undefined : trimmed
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Writing is context assembly plus one queue job. The cloud composes the
 * prompt from rows it owns and the harness answers it; no model call ever
 * happens in the server process.
 */
export class WritingService extends Context.Service<WritingService, WritingServiceShape>()(
  "otbor/cloud/WritingService"
) {
  static readonly layer = Layer.effect(
    WritingService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const enqueue = (
        tx: Executor,
        input: {
          readonly userId: string
          readonly hhAccountId: string | null
          readonly prompt: WritingPrompt
          readonly model?: string
          readonly harness?: string
          readonly effort?: string
        }
      ) =>
        inferenceJob(tx, {
          userId: input.userId,
          hhAccountId: input.hhAccountId,
          payload: {
            prompt: input.prompt.user,
            system: input.prompt.system,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.harness === undefined ? {} : { harness: input.harness }),
            ...(input.effort === undefined ? {} : { effort: input.effort })
          },
          idempotencyKey: `writing:${input.userId}:${randomUUID()}`
        })

      const coverLetter: WritingServiceShape["coverLetter"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const loaded = yield* loadApplicationContext(
                  tx,
                  currentUser.userId,
                  input.applicationId
                )
                if (loaded._tag === "missing") return loaded

                const { application, vacancy, resumeText } = loaded.context
                const prompt = buildCoverLetterPrompt({
                  vacancy: vacancyContext(vacancy),
                  resumeText,
                  ...(input.tone === undefined ? {} : { tone: input.tone }),
                  ...(input.length === undefined ? {} : { length: input.length }),
                  ...(input.language === undefined ? {} : { language: input.language })
                })
                const job = yield* enqueue(tx, {
                  userId: currentUser.userId,
                  hhAccountId: application.hhAccountId,
                  prompt,
                  model: modelOf(input.model)
                })
                return { _tag: "ok" as const, job }
              })
            )
            .pipe(Effect.mapError(toStorageError("writing.coverLetter")))

          if (outcome._tag === "missing") {
            return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
          }
          return { job: outcome.job }
        })

      const answers: WritingServiceShape["answers"] = (input) =>
        Effect.gen(function*() {
          const questions = input.questions.map((question) => question.trim())
          if (questions.length === 0) {
            return yield* new InvalidInput({
              message: "at least one question is required"
            })
          }
          if (questions.some((question) => question === "")) {
            return yield* new InvalidInput({
              message: "questions must not be empty"
            })
          }

          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const loaded = yield* loadApplicationContext(
                  tx,
                  currentUser.userId,
                  input.applicationId
                )
                if (loaded._tag === "missing") return loaded

                const { application, vacancy, resumeText } = loaded.context
                const prompt = buildAnswersPrompt({
                  vacancy: vacancyContext(vacancy),
                  resumeText,
                  questions,
                  ...(input.language === undefined ? {} : { language: input.language })
                })
                const job = yield* enqueue(tx, {
                  userId: currentUser.userId,
                  hhAccountId: application.hhAccountId,
                  prompt,
                  model: modelOf(input.model)
                })
                return { _tag: "ok" as const, job }
              })
            )
            .pipe(Effect.mapError(toStorageError("writing.answers")))

          if (outcome._tag === "missing") {
            return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
          }
          return { job: outcome.job }
        })

      const resume: WritingServiceShape["resume"] = (input) =>
        Effect.gen(function*() {
          if (input.text.trim() === "") {
            return yield* new InvalidInput({
              message: "resume text must not be empty"
            })
          }

          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const hhAccountId = yield* accountFor(tx, currentUser.userId)
                const prompt = buildResumePrompt({
                  text: input.text,
                  ...(input.targetRole === undefined ? {} : { targetRole: input.targetRole }),
                  ...(input.language === undefined ? {} : { language: input.language })
                })
                const job = yield* enqueue(tx, {
                  userId: currentUser.userId,
                  hhAccountId,
                  prompt,
                  model: modelOf(input.model)
                })
                return { _tag: "ok" as const, job }
              })
            )
            .pipe(Effect.mapError(toStorageError("writing.resume")))

          return { job: outcome.job }
        })

      const draft: WritingServiceShape["draft"] = (input) =>
        Effect.gen(function*() {
          if (input.harness.trim() === "") {
            return yield* new InvalidInput({ message: "a harness must be chosen" })
          }
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const account = yield* tx.execute(
                  sql`select id from hh_account where id = ${input.hhAccountId} limit 1`
                )
                if (account.rows.length === 0) return missing("HhAccount", input.hhAccountId)

                const vacancy = yield* VacancyRepository.findById(tx, input.vacancyId)
                if (vacancy === null) return missing("Vacancy", input.vacancyId)

                const resumeId = input.resumeId ?? null
                const resumeText =
                  resumeId === null ? null : yield* resumeTextFor(tx, currentUser.userId, resumeId)
                if (resumeId !== null && resumeText === null) return missing("Resume", resumeId)

                // The form is the vacancy's, the same for every applicant. Without
                // one (no test, never read) there are no questions to answer.
                const state = yield* VacancyFormRepository.getState(tx, vacancy.id)
                const form = state.form
                const signal = yield* tx.execute(
                  sql`select signals->'hh'->>'letterRequired' as required from vacancy where id = ${vacancy.id} limit 1`
                )
                const letterRequired = (signal.rows[0] as { required?: string | null } | undefined)?.required === "true"
                const prompt = buildDraftPrompt({
                  vacancy: vacancyContext(vacancy),
                  resumeText,
                  coverLetter: form?.coverLetter ?? (letterRequired ? "required" : "optional"),
                  questions: (form?.questions ?? []).map((question) => ({
                    id: question.id,
                    kind: question.kind,
                    text: question.text,
                    required: question.required,
                    maxLength: question.maxLength ?? null,
                    options: question.options
                  })),
                  ...(input.language === undefined ? {} : { language: input.language })
                })
                const job = yield* enqueue(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  prompt,
                  model: modelOf(input.model),
                  harness: input.harness.trim(),
                  effort: modelOf(input.effort)
                })
                return { _tag: "ok" as const, job }
              })
            )
            .pipe(Effect.mapError(toStorageError("writing.draft")))

          if (outcome._tag === "missing") {
            return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
          }
          return { job: outcome.job }
        })

      return WritingService.of({ coverLetter, answers, resume, draft })
    })
  )
}
