import type {
  ApiError,
  EmployerDetail,
  EmployerSummary,
  HydrationTarget,
  IngestResult,
  KeywordMatchRecord,
  VacancyDetail,
  VacancyDraft,
  VacancySummary
} from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import {
  detectVacancyTextFacts,
  extractContactsFromText,
  gateTitle,
  matchLexicon,
  titleCacheKey
} from "@otbor/domain"
import { Effect, Context, Layer } from "effect"
import type { Executor } from "../db/Database.ts"
import { Database } from "../db/Database.ts"
import { CurrentUser } from "./CurrentUser.ts"
import * as ContactRepository from "../repositories/ContactRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as EmployerRepository from "../repositories/EmployerRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { toStorageError, stableHash } from "./support.ts"

const toKeywordMatch = (match: LexiconRepository.StoredMatch): KeywordMatchRecord => ({
  keywordId: match.keywordId as KeywordMatchRecord["keywordId"],
  term: match.term,
  aliasId: match.aliasId as KeywordMatchRecord["aliasId"],
  matchedForm: match.matchedForm,
  typo: match.typo,
  inTitle: match.inTitle,
  titleCount: match.titleCount,
  inBody: match.inBody,
  bodyCount: match.bodyCount,
  inSkills: match.inSkills
})

const contentHash = (draft: VacancyDraft): string =>
  stableHash({
    title: draft.title,
    descriptionText: draft.descriptionText ?? null,
    skills: [...(draft.skills ?? [])].sort(),
    salary: draft.salary ?? null,
    workFormats: draft.workFormats ?? [],
    seniority: draft.seniority ?? "unknown",
    publishedAt: draft.publishedAt ?? null,
    archived: draft.archived ?? false,
    employer: draft.employer ?? null,
    areaName: draft.areaName ?? null
  })

const persistDraft = (tx: Executor, draft: VacancyDraft, contactUserId: string) =>
  Effect.gen(function*() {
    const source = draft.source ?? "hh"
    const existing = yield* VacancyRepository.findByExternal(tx, source, draft.externalId)
    const effective = VacancyRepository.mergeStubDescription(draft, existing)
    const hash = contentHash(effective)

    if (existing !== null && existing.contentHash === hash) {
      yield* VacancyRepository.touch(tx, existing.id)
      if (draft.hhSignals !== undefined) {
        yield* VacancyRepository.mergeHhSignals(tx, existing.id, draft.hhSignals)
      }
      return { status: "skipped" as const, row: existing }
    }

    const employerRow =
      effective.employer === null || effective.employer === undefined
        ? null
        : yield* VacancyRepository.upsertEmployer(tx, source, effective.employer)

    const [vacancyRow] = yield* VacancyRepository.upsertVacancy(tx, {
      draft: effective,
      employerId: employerRow?.[0]?.id ?? null,
      contentHash: hash,
      source
    })

    const vacancyId = vacancyRow!.id
    const skills = effective.skills ?? []

    yield* VacancyRepository.replaceSkills(tx, vacancyId, skills)
    yield* VacancyRepository.insertSnapshot(tx, {
      vacancyId,
      contentHash: hash,
      raw: effective.raw ?? null,
      descriptionText: effective.descriptionText ?? null,
      adapter: source
    })
    yield* VacancyRepository.insertResponseSample(tx, {
      vacancyId,
      total: effective.responsesTotal ?? null,
      vacancy: effective.responsesVacancy ?? null
    })

    const gate = gateTitle(effective.title)
    yield* DecisionRepository.cacheRulesVerdict(tx, gate)

    const entries = yield* LexiconRepository.loadEntries(tx)
    const matches = matchLexicon(entries, {
      title: effective.title,
      body: effective.descriptionText ?? "",
      skills
    })
    yield* LexiconRepository.replaceMatches(tx, vacancyId, matches)

    // HR contact details are extracted from the vacancy text, never invented.
    const extraction = extractContactsFromText(
      [effective.title, effective.descriptionText ?? ""].filter(Boolean).join("\n")
    )
    if (extraction.contacts.length > 0) {
      yield* ContactRepository.upsertMany(tx, {
        userId: contactUserId,
        contacts: extraction.contacts,
        source: "hh_vacancy",
        vacancyId,
        employerId: employerRow?.[0]?.id ?? null
      })
    }

    const row = yield* VacancyRepository.findById(tx, vacancyId)
    return { status: existing === null ? ("inserted" as const) : ("updated" as const), row: row! }
  })

export interface CorpusServiceShape {
  readonly ingest: (
    drafts: ReadonlyArray<VacancyDraft>,
    options?: { readonly userId?: string }
  ) => Effect.Effect<IngestResult, ApiError>
  readonly list: (filter: VacancyRepository.VacancyFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<VacancySummary>; readonly total: number },
    ApiError
  >
  readonly get: (id: string) => Effect.Effect<VacancyDetail, ApiError>
  readonly recomputeKeywords: (id: string) => Effect.Effect<number, ApiError>
  readonly hydrationTargets: (
    filter: VacancyRepository.HydrationFilter
  ) => Effect.Effect<ReadonlyArray<HydrationTarget>, ApiError>
  readonly employers: (filter: EmployerRepository.EmployerFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<EmployerSummary>; readonly total: number },
    ApiError
  >
  readonly employer: (id: string) => Effect.Effect<EmployerDetail, ApiError>
}

export class CorpusService extends Context.Service<CorpusService, CorpusServiceShape>()(
  "otbor/cloud/CorpusService"
) {
  static readonly layer = Layer.effect(
    CorpusService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const ingest: CorpusServiceShape["ingest"] = (drafts, options = {}) =>
        Effect.gen(function*() {
          if (drafts.length === 0) {
            return { inserted: 0, updated: 0, skipped: 0, items: [] }
          }

          const contactUserId = options.userId ?? currentUser.userId

          return yield* database
            .asOwner((tx) =>
              Effect.gen(function*() {
                let inserted = 0
                let updated = 0
                let skipped = 0
                const items: Array<VacancySummary> = []

                for (const draft of drafts) {
                  const result = yield* persistDraft(tx, draft, contactUserId)
                  if (result.status === "inserted") inserted += 1
                  else if (result.status === "updated") updated += 1
                  else skipped += 1
                  items.push(VacancyRepository.toSummary(result.row))
                }

                return { inserted, updated, skipped, items }
              })
            )
            .pipe(Effect.mapError(toStorageError("vacancy.ingest")))
        })

      const list: CorpusServiceShape["list"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            VacancyRepository.list(tx, { ...filter, userId: currentUser.userId })
          )
          .pipe(Effect.mapError(toStorageError("vacancy.list")))

      const get: CorpusServiceShape["get"] = (id) =>
        Effect.gen(function*() {
          const detail = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const row = yield* VacancyRepository.findById(tx, id)
                if (row === null) return null
                const keywords = yield* LexiconRepository.matchesFor(tx, id)
                const verdict = yield* DecisionRepository.findVerdict(tx, titleCacheKey(row.title))
                const hhSignals = yield* VacancyRepository.hhSignalsOf(tx, id)
                return { row, keywords, verdict, hhSignals }
              })
            )
            .pipe(Effect.mapError(toStorageError("vacancy.get")))

          if (detail === null) {
            return yield* new NotFound({ entity: "Vacancy", id })
          }

          return {
            vacancy: VacancyRepository.toSummary(detail.row),
            descriptionText: detail.row.descriptionText ?? "",
            descriptionHtml: detail.row.descriptionHtml,
            skills: detail.row.skills,
            keywords: detail.keywords.map(toKeywordMatch),
            titleVerdict: detail.verdict?.verdict ?? null,
            facts: {
              hh: detail.hhSignals,
              text: detectVacancyTextFacts(detail.row.descriptionText)
            },
            responsesTotal: detail.row.responsesTotal ?? null,
            responsesVacancy: detail.row.responsesVacancy ?? null
          }
        })

      const recomputeKeywords: CorpusServiceShape["recomputeKeywords"] = (id) =>
        Effect.gen(function*() {
          const count = yield* database
            .asOwner((tx) =>
              Effect.gen(function*() {
                const row = yield* VacancyRepository.findById(tx, id)
                if (row === null) return -1
                const entries = yield* LexiconRepository.loadEntries(tx)
                const matches = matchLexicon(entries, {
                  title: row.title,
                  body: row.descriptionText ?? "",
                  skills: row.skills
                })
                yield* LexiconRepository.replaceMatches(tx, id, matches)
                return matches.length
              })
            )
            .pipe(Effect.mapError(toStorageError("vacancy.recompute")))

          if (count < 0) return yield* new NotFound({ entity: "Vacancy", id })
          return count
        })

      const hydrationTargets: CorpusServiceShape["hydrationTargets"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) => VacancyRepository.listNeedingHydration(tx, filter))
          .pipe(Effect.mapError(toStorageError("vacancy.hydrationTargets")))

      const employers: CorpusServiceShape["employers"] = (filter) =>
        database
          .asUser(currentUser.userId, (tx) =>
            EmployerRepository.list(tx, { ...filter, userId: currentUser.userId })
          )
          .pipe(Effect.mapError(toStorageError("employer.list")))

      const employer: CorpusServiceShape["employer"] = (id) =>
        Effect.gen(function*() {
          const detail = yield* database
            .asUser(currentUser.userId, (tx) =>
              EmployerRepository.findById(tx, id, { userId: currentUser.userId })
            )
            .pipe(Effect.mapError(toStorageError("employer.get")))

          if (detail === null) {
            return yield* new NotFound({ entity: "Employer", id })
          }
          return detail
        })

      return CorpusService.of({
        ingest,
        list,
        get,
        recomputeKeywords,
        hydrationTargets,
        employers,
        employer
      })
    })
  )
}
