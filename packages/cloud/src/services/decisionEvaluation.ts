import type {
  ApiError,
  DecisionRecord,
  EvaluateBatchResult,
  WorkFormat
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  ANALYSIS_PROMPT_VERSION,
  APPLY_POLICY_VERSION,
  currentVersions,
  decide,
  detectVacancyTextFacts,
  mergeTextFacts,
  toDecisionAnalysis,
  type LexiconMatch,
  type VacancySignal
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as VacancyAnalysisRepository from "../repositories/VacancyAnalysisRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { currentFitFor } from "./fitInputs.ts"
import { stableHash, toStorageError } from "./support.ts"

const asWorkFormats = (values: ReadonlyArray<string>): ReadonlyArray<WorkFormat> =>
  values.filter((value): value is WorkFormat =>
    value === "remote" || value === "hybrid" || value === "office" || value === "unknown"
  )

const signalFrom = (row: VacancyRepository.VacancyRow): VacancySignal => ({
  id: row.id,
  title: row.title,
  archived: row.archived,
  salaryFrom: row.salaryFrom,
  salaryTo: row.salaryTo,
  salaryCurrency: row.salaryCurrency,
  workFormats: asWorkFormats(row.workFormats),
  seniority: row.seniority as VacancySignal["seniority"],
  publishedAt: row.publishedAt?.toISOString() ?? null,
  employerId: row.employerId,
  employerName: row.employerName,
  skills: row.skills,
  descriptionText: row.descriptionText ?? ""
})

const toLexiconMatch = (match: LexiconRepository.StoredMatch): LexiconMatch => ({
  keywordId: match.keywordId,
  term: match.term,
  aliasId: match.aliasId,
  matchedForm: match.matchedForm,
  typo: match.typo,
  inTitle: match.inTitle,
  titleCount: match.titleCount,
  inBody: match.inBody,
  bodyCount: match.bodyCount,
  inSkills: match.inSkills
})

/** The default hh account of a user, when one exists. */
export const defaultHhAccount = (tx: Executor, userId: string) =>
  tx
    .execute(sql`
      select id from hh_account
      where user_id = ${userId}
      order by is_default desc, created_at asc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

export interface EvaluateInput {
  readonly vacancyId: string
  readonly resumeId?: string | null
  readonly fit?: number | null
  /** Explicit account; omitted uses the user's default hh account. */
  readonly hhAccountId?: string | null
  /** Default `false`: a blacklist match becomes a `blocked_blacklist` skip. */
  readonly includeBlacklisted?: boolean
}

export interface EvaluateBatchInput {
  /** Vacancies per (account, resume) scope; default 500, at most {@link MAX_BATCH}. */
  readonly limit?: number
  /** Только этот аккаунт; без него - каждый аккаунт с фильтром (не «аккаунт по умолчанию»). */
  readonly hhAccountId?: string | null
  /** Только это резюме; без него - каждое резюме области. */
  readonly resumeId?: string | null
  /** Re-run the cascade for vacancies whose decision is already current. */
  readonly force?: boolean
  /** Restrict to these vacancies (still subject to staleness unless `force`). */
  readonly vacancyIds?: ReadonlyArray<string>
  readonly includeBlacklisted?: boolean
}

export const DEFAULT_BATCH = 500
export const MAX_BATCH = 2000
/** One transaction per chunk: bounded lock time, partial progress survives. */
const CHUNK = 50

/**
 * The decision cascade for one vacancy, inside a user-scoped transaction.
 * Single and batch evaluation both call this, so the cascade exists once.
 */
export const evaluateInTx = (
  tx: Executor,
  userId: string,
  input: EvaluateInput,
  hhAccountId: string | null,
  /** Analyses loaded for the whole batch in one query; omitted, this vacancy's is read here. */
  preloaded?: { readonly analysis: VacancyAnalysisRepository.StoredAnalysis | null }
): RepoEffect<DecisionRecord | null> =>
  Effect.gen(function*() {
    const row = yield* VacancyRepository.findById(tx, input.vacancyId)
    if (row === null) return null

    const analysis = preloaded === undefined
      ? yield* VacancyAnalysisRepository.get(tx, input.vacancyId, ANALYSIS_PROMPT_VERSION)
      : preloaded.analysis
    const analysisSignal = analysis === null ? null : toDecisionAnalysis(analysis.facts)
    // A confident model answer or the regex detector: an unpaid test task blocks
    // under the default `human` policy, like a mandatory one.
    const unpaidTest = mergeTextFacts(
      detectVacancyTextFacts(row.descriptionText),
      analysis?.facts ?? null
    ).conditions?.testTask === "unpaid"

    const stored = yield* LexiconRepository.matchesFor(tx, input.vacancyId)
    const keywords = stored.map(toLexiconMatch)

    // An explicit fit wins. Otherwise a current personal judgement (LLM or
    // external agent) replaces the deterministic fit; a stale one is ignored,
    // never recomputed here.
    const llm = input.fit === undefined || input.fit === null
      ? yield* currentFitFor(tx, userId, { id: row.id, contentHash: row.contentHash }, input.resumeId)
      : null
    const fit = input.fit ?? llm?.judgement.fit ?? null
    const resumeId = input.resumeId ?? llm?.resumeId ?? null

    // Applied means applied with this resume: another resume may still apply.
    const applied = hhAccountId === null
      ? false
      : yield* ApplicationRepository.existsForVacancy(tx, hhAccountId, row.id, resumeId)

    // The hard blocks: the (account, resume) apply filter, evaluated by the
    // same SQL as search. The blacklist is part of it; an explicit
    // `includeBlacklisted` still lifts it.
    const resolved = yield* ApplyFilterRepository.resolve(tx, userId, hhAccountId, resumeId)
    const outcome = yield* LexiconRepository.evaluateFilter(tx, resolved.filter, row.id, {
      userId,
      includeBlacklisted: input.includeBlacklisted === true
    })
    // Boosts are scored by the same rule SQL; their summed weight is the only
    // thing `decide` sees of them.
    const boostHits = yield* LexiconRepository.evaluateBoosts(tx, resolved.boosts, row.id, { userId })
    const boostWeight = resolved.boosts.reduce(
      (total, boost, index) => total + (boostHits[index] === true ? boost.weight : 0),
      0
    )
    const settings = {
      minFit: resolved.minFit,
      tests: resolved.tests,
      freshHalfLifeHours: resolved.freshHalfLifeHours
    }
    const blocks = {
      applied,
      hasTest: unpaidTest,
      testRequired: unpaidTest
    }

    const inputHash = stableHash({
      contentHash: row.contentHash,
      // Решение принадлежит паре (аккаунт, резюме): одинаковые входы у разных пар
      // не должны схлопываться в одну строку.
      scope: { hhAccountId, resumeId },
      // A new filter or settings must produce a new decision row.
      filter: stableHash({ filter: resolved.filter, ...settings, boosts: resolved.boosts }),
      boostWeight,
      includeBlacklisted: input.includeBlacklisted === true,
      applied,
      fit,
      fitJudgement: llm?.id,
      policy: APPLY_POLICY_VERSION,
      // Only what the cascade reads from the analysis, so an unrelated fact does not
      // re-decide. Absent keys keep the hashes of vacancies without an analysis stable.
      ...(analysisSignal === null && !unpaidTest ? {} : { analysis: analysisSignal, unpaidTest })
    })

    const decision = decide({
      vacancy: signalFrom(row),
      filter: outcome,
      settings,
      keywords,
      boostWeight,
      blocks,
      analysis: analysisSignal,
      fitOverride: fit ?? undefined,
      now: new Date()
    })

    return yield* DecisionRepository.persist(tx, {
      userId,
      hhAccountId,
      resumeId,
      vacancyId: row.id,
      verdict: decision.verdict,
      fit: decision.fit,
      priority: decision.priority,
      reasons: decision.reasons,
      policyVersion: decision.policyVersion,
      inputHash,
      vacancyContentHash: row.contentHash,
      restamp: analysis !== null
    })

  })

const chunked = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export interface Evaluator {
  readonly evaluate: (
    userId: string,
    input: EvaluateInput
  ) => Effect.Effect<DecisionRecord, ApiError>
  readonly evaluateBatch: (
    userId: string,
    input: EvaluateBatchInput
  ) => Effect.Effect<EvaluateBatchResult, ApiError>
}

/**
 * User-explicit evaluation, so a request (`CurrentUser`) and the worker (the
 * schedule owner) share one implementation.
 */
export const makeEvaluator = (database: Database["Service"]): Evaluator => {
  const evaluate: Evaluator["evaluate"] = (userId, input) =>
    Effect.gen(function*() {
      if (input.fit !== undefined && input.fit !== null && (input.fit < 0 || input.fit > 100)) {
        return yield* new InvalidInput({ message: "fit must be between 0 and 100" })
      }

      const result = yield* database
        .asUser(userId, (tx) =>
          Effect.gen(function*() {
            const hhAccountId = input.hhAccountId === undefined
              ? yield* defaultHhAccount(tx, userId)
              : input.hhAccountId
            return yield* evaluateInTx(tx, userId, input, hhAccountId)
          })
        )
        .pipe(Effect.mapError(toStorageError("decision.evaluate")))

      if (result === null) {
        return yield* new NotFound({ entity: "Vacancy", id: input.vacancyId })
      }

      return result
    })

  const evaluateBatch: Evaluator["evaluateBatch"] = (userId, input) =>
    Effect.gen(function*() {
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_BATCH), 1), MAX_BATCH)
      const force = input.force === true

      // Решение принимается для каждой пары (аккаунт, резюме) отдельно.
      const scopes = yield* database
        .asUser(userId, (tx) =>
          DecisionRepository.evaluationScopes(tx, userId, {
            hhAccountId: input.hhAccountId,
            resumeId: input.resumeId
          })
        )
        .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

      let evaluated = 0
      let remaining = 0
      const verdicts = { apply: 0, draft: 0, skip: 0 }
      const byReason: Record<string, number> = {}

      for (const scope of scopes) {
        const staleOptions = {
          userId,
          hhAccountId: scope.hhAccountId,
          resumeId: scope.resumeId,
          policyVersion: currentVersions.policyVersion,
          analysisPromptVersion: ANALYSIS_PROMPT_VERSION,
          vacancyIds: input.vacancyIds
        }
        const ids = yield* database
          .asUser(userId, (tx) =>
            DecisionRepository.staleVacancyIds(tx, { ...staleOptions, force, limit })
          )
          .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

        let scopeEvaluated = 0
        for (const chunk of chunked(ids, CHUNK)) {
          const results = yield* database
            .asUser(userId, (tx) =>
              Effect.gen(function*() {
                const analyses = yield* VacancyAnalysisRepository.getMany(tx, chunk, ANALYSIS_PROMPT_VERSION)
                return yield* Effect.forEach(chunk, (vacancyId) =>
                  evaluateInTx(
                    tx,
                    userId,
                    {
                      vacancyId,
                      resumeId: scope.resumeId,
                      hhAccountId: scope.hhAccountId,
                      includeBlacklisted: input.includeBlacklisted
                    },
                    scope.hhAccountId,
                    { analysis: analyses.get(vacancyId) ?? null }
                  )
                )
              })
            )
            .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

          for (const result of results) {
            if (result === null) continue
            evaluated += 1
            scopeEvaluated += 1
            verdicts[result.verdict] += 1
            const reason = result.reasons[0]?.code ?? "none"
            byReason[reason] = (byReason[reason] ?? 0) + 1
          }
        }

        const pending = yield* database
          .asUser(userId, (tx) =>
            DecisionRepository.countStaleVacancies(tx, { ...staleOptions, force })
          )
          .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))
        // With `force` everything is "stale"; what is left is what this call did not reach.
        remaining += force ? Math.max(0, pending - scopeEvaluated) : pending
      }

      return { evaluated, ...verdicts, remaining, byReason }
    })

  return { evaluate, evaluateBatch }
}
