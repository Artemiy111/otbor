import type {
  ApiError,
  IngestResult,
  KeywordMatchRecord,
  VacancyDetail,
  VacancyDraft,
  VacancySummary
} from "@otbor/contract"
import { NotFound } from "@otbor/contract"
import { gateTitle, matchLexicon, titleCacheKey } from "@otbor/domain"
import { Effect, Context, Layer } from "effect"
import type { Executor } from "../db/Database.ts"
import { Database } from "../db/Database.ts"
import { CurrentUser } from "./CurrentUser.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
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

const persistDraft = (tx: Executor, draft: VacancyDraft) =>
  Effect.gen(function*() {
    const source = draft.source ?? "hh"
    const hash = contentHash(draft)
    const existing = yield* VacancyRepository.findByExternal(tx, source, draft.externalId)

    if (existing !== null && existing.contentHash === hash) {
      yield* VacancyRepository.touch(tx, existing.id)
      return { status: "skipped" as const, row: existing }
    }

    const employerRow =
      draft.employer === null || draft.employer === undefined
        ? null
        : yield* VacancyRepository.upsertEmployer(tx, source, draft.employer)

    const [vacancyRow] = yield* VacancyRepository.upsertVacancy(tx, {
      draft,
      employerId: employerRow?.[0]?.id ?? null,
      contentHash: hash,
      source
    })

    const vacancyId = vacancyRow!.id
    const skills = draft.skills ?? []

    yield* VacancyRepository.replaceSkills(tx, vacancyId, skills)
    yield* VacancyRepository.insertSnapshot(tx, {
      vacancyId,
      contentHash: hash,
      raw: draft.raw ?? null,
      descriptionText: draft.descriptionText ?? null,
      adapter: source
    })
    yield* VacancyRepository.insertResponseSample(tx, {
      vacancyId,
      total: draft.responsesTotal ?? null,
      vacancy: draft.responsesVacancy ?? null
    })

    const gate = gateTitle(draft.title)
    yield* DecisionRepository.cacheRulesVerdict(tx, gate)

    const entries = yield* LexiconRepository.loadEntries(tx)
    const matches = matchLexicon(entries, {
      title: draft.title,
      body: draft.descriptionText ?? "",
      skills
    })
    yield* LexiconRepository.replaceMatches(tx, vacancyId, matches)

    const row = yield* VacancyRepository.findById(tx, vacancyId)
    return { status: existing === null ? ("inserted" as const) : ("updated" as const), row: row! }
  })

export interface CorpusServiceShape {
  readonly ingest: (drafts: ReadonlyArray<VacancyDraft>) => Effect.Effect<IngestResult, ApiError>
  readonly list: (filter: VacancyRepository.VacancyFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<VacancySummary>; readonly total: number },
    ApiError
  >
  readonly get: (id: string) => Effect.Effect<VacancyDetail, ApiError>
  readonly recomputeKeywords: (id: string) => Effect.Effect<number, ApiError>
}

export class CorpusService extends Context.Service<CorpusService, CorpusServiceShape>()(
  "otbor/cloud/CorpusService"
) {
  static readonly layer = Layer.effect(
    CorpusService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const ingest: CorpusServiceShape["ingest"] = (drafts) =>
        Effect.gen(function*() {
          if (drafts.length === 0) {
            return { inserted: 0, updated: 0, skipped: 0, items: [] }
          }

          return yield* database
            .asOwner((tx) =>
              Effect.gen(function*() {
                let inserted = 0
                let updated = 0
                let skipped = 0
                const items: Array<VacancySummary> = []

                for (const draft of drafts) {
                  const result = yield* persistDraft(tx, draft)
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
          .asUser(currentUser.userId, (tx) => VacancyRepository.list(tx, filter))
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
                return { row, keywords, verdict }
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
            titleVerdict: detail.verdict?.verdict ?? null
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

      return CorpusService.of({ ingest, list, get, recomputeKeywords })
    })
  )
}
