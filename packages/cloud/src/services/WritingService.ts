import type { ApiError, HarnessJob, ResumeEnrichment } from "@otbor/contract"
import { InvalidInput, NotFound, RESUME_FAQ_TOPICS } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { Database, type DatabaseError, type Executor } from "../db/Database.ts"
import * as ResumeEnrichmentRepository from "../repositories/ResumeEnrichmentRepository.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { hintsFor } from "./formHints.ts"
import {
  buildDraftPrompt,
  buildResumePrompt,
  resolveEmployment,
  type ApplicantProfile,
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

export interface DraftInput {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  readonly length?: CoverLetterLength
  /** None: the harness default, the same as an auto-apply filter without a writer. */
  readonly harness?: string
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
  readonly resume: (input: ResumeInput) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  /** Cover letter and employer-test answers of a vacancy in one model call. No application needed. */
  readonly draft: (input: DraftInput) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  /** The exact prompt `draft` would send. Calls no model. */
  readonly draftPrompt: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
    readonly length?: CoverLetterLength
  }) => Effect.Effect<
    { readonly system: string; readonly user: string; readonly promptVersion: string },
    ApiError
  >
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

type Missing = {
  readonly _tag: "missing"
  readonly entity: string
  readonly id: string
}

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

const vacancyContext = (vacancy: VacancyRepository.VacancyRow): VacancyContext => ({
  title: vacancy.title,
  employer: vacancy.employerName,
  description: vacancy.descriptionText,
  skills: vacancy.skills
})

/** The enrichment as prompt notes; known FAQ topics get their question text. */
const applicantProfile = (enrichment: ResumeEnrichment): ApplicantProfile => {
  const topics = new Map<string, string>(RESUME_FAQ_TOPICS.map((topic) => [topic.key, topic.question]))
  return {
    comment: enrichment.comment,
    salaries: enrichment.salaries,
    faq: enrichment.faq.map((entry) => ({
      question: topics.get(entry.key) ?? entry.question ?? "",
      answer: entry.answer
    })),
    // The key is the lower-cased "company position" the web saved the note under.
    jobs: enrichment.experience.map((job) => ({
      job: job.key,
      comment: job.comment ?? null,
      leaveReason: job.leaveReason ?? null,
      employmentType: job.employmentType ?? null
    }))
  }
}

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

      /** Loads what a draft prompt needs and builds it. Shared by generate and preview. */
      const loadDraftPrompt = (
        tx: Executor,
        input: {
          readonly vacancyId: string
          readonly hhAccountId: string
          readonly resumeId?: string
          readonly length?: CoverLetterLength
        }
      ) =>
        Effect.gen(function*() {
          const account = yield* tx.execute(
            sql`select first_name, last_name, label from hh_account where id = ${input.hhAccountId} limit 1`
          )
          const accountRow = account.rows[0] as
            | { first_name?: string | null; last_name?: string | null; label?: string | null }
            | undefined
          if (accountRow === undefined) return missing("HhAccount", input.hhAccountId)

          const vacancy = yield* VacancyRepository.findById(tx, input.vacancyId)
          if (vacancy === null) return missing("Vacancy", input.vacancyId)

          const resumeId = input.resumeId ?? null
          const resumeText =
            resumeId === null ? null : yield* resumeTextFor(tx, currentUser.userId, resumeId)
          if (resumeId !== null && resumeText === null) return missing("Resume", resumeId)

          // Works now or not: the operator's word on the resume, else its last job.
          // The enrichment also carries what the operator added: notes, salary,
          // FAQ answers and per-job comments; all of it goes to APPLICANT NOTES.
          let employment = resolveEmployment(null, [])
          let profile: ApplicantProfile | null = null
          if (resumeId !== null) {
            const enrichment = yield* ResumeEnrichmentRepository.get(tx, currentUser.userId, resumeId)
            const jobs = yield* tx.execute(
              sql`select experience from resume where id = ${resumeId} and user_id = ${currentUser.userId} limit 1`
            )
            const experience = (jobs.rows[0] as { experience?: unknown } | undefined)?.experience
            employment = resolveEmployment(
              enrichment?.currentlyEmployed,
              Array.isArray(experience) ? experience : []
            )
            if (enrichment !== null) profile = applicantProfile(enrichment)
          }

          // The form is the vacancy's, the same for every applicant. Without one
          // (no test, never read) there are no questions to answer.
          const state = yield* VacancyFormRepository.getState(tx, vacancy.id)
          const form = state.form
          const hints = form === null
            ? []
            : yield* hintsFor(tx, { userId: currentUser.userId, vacancyId: vacancy.id, resumeId }, form)
          const signal = yield* tx.execute(
            sql`select signals->'hh'->>'letterRequired' as required from vacancy where id = ${vacancy.id} limit 1`
          )
          const letterRequired =
            (signal.rows[0] as { required?: string | null } | undefined)?.required === "true"

          // An account without a first and last name falls back to its label.
          const hasName = (accountRow.first_name ?? "").trim() !== "" || (accountRow.last_name ?? "").trim() !== ""
          const prompt = buildDraftPrompt({
            vacancy: vacancyContext(vacancy),
            resumeText,
            applicant: hasName
              ? { firstName: accountRow.first_name ?? null, lastName: accountRow.last_name ?? null }
              : { firstName: accountRow.label ?? null },
            coverLetter: form?.coverLetter ?? (letterRequired ? "required" : "optional"),
            ...(input.length === undefined ? {} : { length: input.length }),
            employment,
            profile,
            hints,
            questions: (form?.questions ?? []).map((question) => ({
              id: question.id,
              kind: question.kind,
              text: question.text,
              required: question.required,
              maxLength: question.maxLength ?? null,
              options: question.options
            }))
          })
          return { _tag: "ok" as const, prompt }
        })

      const draft: WritingServiceShape["draft"] = (input) =>
        Effect.gen(function*() {
          if (input.harness !== undefined && input.harness.trim() === "") {
            return yield* new InvalidInput({ message: "the harness name is empty" })
          }
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const loaded = yield* loadDraftPrompt(tx, input)
                if (loaded._tag === "missing") return loaded
                const job = yield* enqueue(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  prompt: loaded.prompt,
                  model: modelOf(input.model),
                  harness: modelOf(input.harness),
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

      const draftPrompt: WritingServiceShape["draftPrompt"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) => loadDraftPrompt(tx, input))
            .pipe(Effect.mapError(toStorageError("writing.draftPrompt")))
          if (outcome._tag === "missing") {
            return yield* new NotFound({ entity: outcome.entity, id: outcome.id })
          }
          return {
            system: outcome.prompt.system,
            user: outcome.prompt.user,
            promptVersion: outcome.prompt.promptVersion
          }
        })

      return WritingService.of({ resume, draft, draftPrompt })
    })
  )
}
