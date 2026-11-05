import type { ApplicationRecord, ResponseForm, StoredHint } from "@otbor/contract"
import { answerHints } from "@otbor/domain"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as ResumeEnrichmentRepository from "../repositories/ResumeEnrichmentRepository.ts"
import * as ResumeRepository from "../repositories/ResumeRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"

/**
 * Deterministic answer hints for a form, from the vacancy, the application's
 * resume and the resume enrichment. Candidate facts that live nowhere yet
 * (city, relocation, english level, start date) are not passed: a topic
 * without facts produces no hint, and the answer is left to a model or a human.
 */
export const hintsFor = (
  tx: Executor,
  application: ApplicationRecord,
  form: ResponseForm
): Effect.Effect<ReadonlyArray<StoredHint>, DatabaseError> =>
  Effect.gen(function*() {
    if (form.layout !== "known" || form.questions.length === 0) return []

    const vacancy = yield* VacancyRepository.findById(tx, application.vacancyId)
    if (vacancy === null) return []

    const resume =
      application.resumeId === null || application.resumeId === undefined
        ? null
        : yield* ResumeRepository.findById(tx, application.userId, application.resumeId)
    const enrichment =
      resume === null
        ? null
        : yield* ResumeEnrichmentRepository.get(tx, application.userId, resume.id)

    // The slot in the vacancy's currency wins; otherwise the primary one, which
    // the salary rule reports as a currency mismatch instead of converting.
    const vacancyCurrency = vacancy.salaryCurrency === "RUR" ? "RUB" : vacancy.salaryCurrency
    const slot =
      enrichment?.salaries.find((s) => s.currency === vacancyCurrency) ?? enrichment?.salaries[0] ?? null
    const expectation = slot?.expectation ?? (slot === null ? (resume?.salaryAmount ?? null) : null)
    const minimum = slot?.min ?? null
    const salary =
      expectation === null && minimum === null
        ? null
        : {
            expectation,
            minimum,
            currency: slot?.currency ?? resume?.salaryCurrency ?? null
          }

    // The operator's FAQ answers are facts about the candidate: city, english and
    // start date become soft hints; the rest is left to the agent via the enrichment.
    const faq = (key: string): string | null =>
      enrichment?.faq.find((e) => e.key === key)?.answer.trim() || null

    // hh codes: no_relocation / relocation_possible / relocation_desirable.
    const relocationCode = (resume?.relocation ?? "").toLowerCase()
    const relocation =
      relocationCode === ""
        ? null
        : relocationCode.includes("no_relocation") || relocationCode === "no"
          ? false
          : relocationCode.includes("possible") || relocationCode.includes("maybe")
            ? ("negotiable" as const)
            : true

    return answerHints({
      questions: form.questions,
      vacancy: {
        areaName: vacancy.areaName,
        salaryFrom: vacancy.salaryFrom,
        salaryTo: vacancy.salaryTo,
        salaryCurrency: vacancy.salaryCurrency,
        workFormats: vacancy.workFormats
      },
      salary,
      resumeWorkFormats: resume?.workFormats ?? [],
      profile: { city: faq("city") ?? resume?.areaName ?? null, relocation, english: faq("english_level"), startDate: faq("notice_period") }
    }).map(
      (hint): StoredHint => ({
        questionId: hint.questionId,
        kind: hint.kind,
        ...(hint.optionIds === undefined ? {} : { optionIds: hint.optionIds }),
        ...(hint.text === undefined ? {} : { text: hint.text }),
        hard: hint.hard,
        confidence: hint.confidence,
        note: hint.note,
        evidence: hint.evidence,
        blockers: hint.blockers
      })
    )
  })
