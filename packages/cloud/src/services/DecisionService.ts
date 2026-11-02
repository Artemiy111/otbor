import type { ApiError, DecisionRecord, GateVerdict, RoleFamily, WorkFormat } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  DEFAULT_APPLY_POLICY,
  decide,
  gateTitle,
  titleCacheKey,
  type ApplyPolicy,
  type LexiconMatch,
  type VacancySignal
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as LexiconRepository from "../repositories/LexiconRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
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

/** The default hh account of the current user, when one exists. */
const hhAccountFor = (tx: Executor, userId: string) =>
  tx
    .execute(sql`
      select id from hh_account
      where user_id = ${userId}
      order by is_default desc, created_at asc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

const isHidden = (tx: Executor, userId: string, externalId: string) =>
  tx
    .execute(sql`
      select 1 from hidden_target
      where user_id = ${userId} and type = 'vacancy' and external_id = ${externalId}
      limit 1
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface EvaluateInput {
  readonly vacancyId: string
  readonly resumeId?: string | null
  readonly fit?: number | null
}

export interface DecisionServiceShape {
  readonly evaluate: (input: EvaluateInput) => Effect.Effect<DecisionRecord, ApiError>
  readonly list: (options: {
    readonly verdict?: string
    readonly limit?: number
    readonly offset?: number
  }) => Effect.Effect<ReadonlyArray<DecisionRecord>, ApiError>
}

export class DecisionService extends Context.Service<DecisionService, DecisionServiceShape>()(
  "otbor/cloud/DecisionService"
) {
  static readonly layer = Layer.effect(
    DecisionService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const evaluate: DecisionServiceShape["evaluate"] = (input) =>
        Effect.gen(function*() {
          if (input.fit !== undefined && input.fit !== null && (input.fit < 0 || input.fit > 100)) {
            return yield* new InvalidInput({ message: "fit must be between 0 and 100" })
          }

          const result = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const row = yield* VacancyRepository.findById(tx, input.vacancyId)
                if (row === null) return null

                const stored = yield* LexiconRepository.matchesFor(tx, input.vacancyId)
                const keywords = stored.map(toLexiconMatch)

                // A user verdict outranks the rules; otherwise evaluate the
                // current rules and cache the result for the next vacancy with
                // the same normalized title. The rules cache is shared state,
                // so it is written by the owner before the user-scoped read.
                const cached = yield* DecisionRepository.findVerdict(tx, titleCacheKey(row.title))
                const gateRules = gateTitle(row.title)

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

                const hhAccountId = yield* hhAccountFor(tx, currentUser.userId)
                const applied =
                  hhAccountId === null
                    ? false
                    : yield* ApplicationRepository.existsForVacancy(tx, hhAccountId, row.id)

                const hidden = yield* isHidden(tx, currentUser.userId, row.externalId)

                const policy: ApplyPolicy = DEFAULT_APPLY_POLICY
                const blocks = {
                  hidden,
                  applied,
                  employerCooldown: false,
                  hasTest: false,
                  testRequired: false
                }

                const inputHash = stableHash({
                  contentHash: row.contentHash,
                  gate: gate.verdict,
                  rulesVersion: gate.rulesVersion,
                  hidden,
                  applied,
                  fit: input.fit ?? null,
                  policy: policy.version
                })

                const decision = decide({
                  vacancy: signalFrom(row),
                  gate,
                  keywords,
                  blocks,
                  policy,
                  fitOverride: input.fit ?? undefined,
                  now: new Date()
                })

                return yield* DecisionRepository.persist(tx, {
                  userId: currentUser.userId,
                  hhAccountId,
                  resumeId: input.resumeId ?? null,
                  vacancyId: row.id,
                  verdict: decision.verdict,
                  gate: decision.gate,
                  roleFamily: decision.roleFamily,
                  fit: decision.fit,
                  priority: decision.priority,
                  reasons: decision.reasons,
                  policyVersion: decision.policyVersion,
                  rulesVersion: decision.rulesVersion,
                  inputHash
                }).pipe(
                  Effect.map((record) => ({
                    record,
                    cache: cached === null ? gateRules : null
                  }))
                )
              })
            )
            .pipe(Effect.mapError(toStorageError("decision.evaluate")))

          if (result === null) {
            return yield* new NotFound({ entity: "Vacancy", id: input.vacancyId })
          }

          if (result.cache !== null) {
            yield* database
              .asOwner((tx) => DecisionRepository.cacheRulesVerdict(tx, result.cache!))
              .pipe(Effect.mapError(toStorageError("title.cache")))
          }

          return result.record
        })

      const list: DecisionServiceShape["list"] = (options) =>
        database
          .asUser(currentUser.userId, (tx) =>
            DecisionRepository.list(tx, currentUser.userId, options)
          )
          .pipe(Effect.mapError(toStorageError("decision.list")))

      return DecisionService.of({ evaluate, list })
    })
  )
}
