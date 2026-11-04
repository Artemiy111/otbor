import type {
  ApiError,
  DecisionRecord,
  EvaluateBatchResult,
  GateVerdict,
  RoleFamily,
  WorkFormat
} from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  ANALYSIS_PROMPT_VERSION,
  currentVersions,
  DEFAULT_APPLY_POLICY,
  decide,
  detectVacancyTextFacts,
  gateTitle,
  mergeTextFacts,
  titleCacheKey,
  toDecisionAnalysis,
  type ApplyPolicy,
  type LexiconMatch,
  type RoleGateOutput,
  type VacancySignal
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as BlacklistRepository from "../repositories/BlacklistRepository.ts"
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
  /** Vacancies per call; default 500, at most {@link MAX_BATCH}. */
  readonly limit?: number
  readonly hhAccountId?: string | null
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

/** The result of the shared cascade for one vacancy, before the title cache write. */
interface Evaluated {
  readonly record: DecisionRecord
  /** A rules verdict to cache for the next vacancy with this normalized title. */
  readonly cache: RoleGateOutput | null
}

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
): RepoEffect<Evaluated | null> =>
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

    // A user verdict outranks the rules; otherwise evaluate the current rules
    // and cache the result for the next vacancy with the same normalized
    // title. A cached rules verdict from older rules is not trusted: it would
    // pin the decision to a stale rulesVersion and the sweep would redo it.
    const gateRules = gateTitle(row.title)
    const found = yield* DecisionRepository.findVerdict(tx, titleCacheKey(row.title))
    const cached = found !== null &&
        (found.source === "user" || found.rulesVersion >= gateRules.rulesVersion)
      ? found
      : null

    const gate = cached === null
      ? {
          verdict: gateRules.verdict,
          roleFamily: gateRules.role as RoleFamily,
          rejectedBy: gateRules.rejectedBy,
          rulesVersion: gateRules.rulesVersion,
          weak: gateRules.weak
        }
      : {
          verdict: cached.verdict as GateVerdict,
          roleFamily: cached.roleFamily as RoleFamily | null,
          rejectedBy: cached.rejectedBy ?? null,
          rulesVersion: cached.rulesVersion,
          weak: [] as ReadonlyArray<string>
        }

    // The blacklist is a soft filter: the layers are computed even when
    // included, and only a caller that did not ask for them turns the match
    // into a block.
    const layers = yield* BlacklistRepository.layersFor(tx, {
      userId,
      hhAccountId,
      employerExternalId: row.employerExternalId,
      vacancyExternalId: row.externalId
    })
    const blacklist = input.includeBlacklisted === true
      ? null
      : BlacklistRepository.primaryMatch(layers)

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

    const policy: ApplyPolicy = DEFAULT_APPLY_POLICY
    const blocks = {
      hidden: false,
      blacklist,
      applied,
      employerCooldown: false,
      hasTest: unpaidTest,
      testRequired: unpaidTest
    }

    const inputHash = stableHash({
      contentHash: row.contentHash,
      gate: gate.verdict,
      rulesVersion: gate.rulesVersion,
      hidden: false,
      blacklist: blacklist === null ? null : `${blacklist.target}:${blacklist.scope}`,
      applied,
      fit,
      fitJudgement: llm?.id,
      policy: policy.version,
      // Only what the cascade reads from the analysis, so an unrelated fact does not
      // re-decide. Absent keys keep the hashes of vacancies without an analysis stable.
      ...(analysisSignal === null && !unpaidTest ? {} : { analysis: analysisSignal, unpaidTest })
    })

    const decision = decide({
      vacancy: signalFrom(row),
      gate,
      keywords,
      blocks,
      policy,
      analysis: analysisSignal,
      fitOverride: fit ?? undefined,
      now: new Date()
    })

    const record = yield* DecisionRepository.persist(tx, {
      userId,
      hhAccountId,
      resumeId,
      vacancyId: row.id,
      verdict: decision.verdict,
      gate: decision.gate,
      roleFamily: decision.roleFamily,
      fit: decision.fit,
      priority: decision.priority,
      reasons: decision.reasons,
      policyVersion: decision.policyVersion,
      rulesVersion: decision.rulesVersion,
      inputHash,
      vacancyContentHash: row.contentHash,
      restamp: analysis !== null
    })

    return { record, cache: cached === null ? gateRules : null }
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
  const writeCaches = (caches: Iterable<RoleGateOutput>) => {
    const unique = new Map<string, RoleGateOutput>()
    for (const gate of caches) unique.set(gate.titleNormalized, gate)
    if (unique.size === 0) return Effect.void
    return database
      .asOwner((tx) =>
        Effect.forEach([...unique.values()], (gate) =>
          DecisionRepository.cacheRulesVerdict(tx, gate), { discard: true })
      )
      .pipe(Effect.mapError(toStorageError("title.cache")))
  }

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

      if (result.cache !== null) yield* writeCaches([result.cache])
      return result.record
    })

  const evaluateBatch: Evaluator["evaluateBatch"] = (userId, input) =>
    Effect.gen(function*() {
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_BATCH), 1), MAX_BATCH)
      const force = input.force === true
      const staleOptions = {
        userId,
        policyVersion: currentVersions.policyVersion,
        rulesVersion: currentVersions.rulesVersion,
        analysisPromptVersion: ANALYSIS_PROMPT_VERSION,
        vacancyIds: input.vacancyIds
      }

      const { ids, hhAccountId } = yield* database
        .asUser(userId, (tx) =>
          Effect.gen(function*() {
            const account = input.hhAccountId === undefined || input.hhAccountId === null
              ? yield* defaultHhAccount(tx, userId)
              : input.hhAccountId
            const found = yield* DecisionRepository.staleVacancyIds(tx, {
              ...staleOptions,
              force,
              limit
            })
            return { ids: found, hhAccountId: account }
          })
        )
        .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

      let evaluated = 0
      const verdicts = { apply: 0, draft: 0, skip: 0 }
      const byReason: Record<string, number> = {}

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
                    resumeId: input.resumeId,
                    hhAccountId,
                    includeBlacklisted: input.includeBlacklisted
                  },
                  hhAccountId,
                  { analysis: analyses.get(vacancyId) ?? null }
                )
              )
            })
          )
          .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

        const caches: Array<RoleGateOutput> = []
        for (const result of results) {
          if (result === null) continue
          evaluated += 1
          verdicts[result.record.verdict] += 1
          const reason = result.record.reasons[0]?.code ?? "none"
          byReason[reason] = (byReason[reason] ?? 0) + 1
          if (result.cache !== null) caches.push(result.cache)
        }
        yield* writeCaches(caches)
      }

      const pending = yield* database
        .asUser(userId, (tx) =>
          DecisionRepository.countStaleVacancies(tx, { ...staleOptions, force })
        )
        .pipe(Effect.mapError(toStorageError("decision.evaluateBatch")))

      return {
        evaluated,
        ...verdicts,
        // With `force` everything is "stale"; what is left is what this call did not reach.
        remaining: force ? Math.max(0, pending - evaluated) : pending,
        byReason
      }
    })

  return { evaluate, evaluateBatch }
}
