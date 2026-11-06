import { Schema } from "effect"
import { DecisionReasonCode, DecisionVerdict } from "../enums.ts"
import {
  DecisionId,
  HhAccountId,
  KeywordAliasId,
  KeywordId,
  ResumeId,
  UserId,
  VacancyId
} from "../ids.ts"

export const KeywordAliasRecord = Schema.Struct({
  id: KeywordAliasId,
  alias: Schema.String,
  normalizedAlias: Schema.String,
  typo: Schema.Boolean,
  matchType: Schema.String
})

export type KeywordAliasRecord = typeof KeywordAliasRecord.Type

export const KeywordAliasStat = Schema.Struct({
  alias: Schema.String,
  normalizedAlias: Schema.String,
  typo: Schema.Boolean,
  vacancies: Schema.Int,
  mentions: Schema.Int,
  share: Schema.Int
})

export type KeywordAliasStat = typeof KeywordAliasStat.Type

export const LexiconKeyword = Schema.Struct({
  id: KeywordId,
  term: Schema.String,
  normalizedTerm: Schema.String,
  /** Vacancies that mention this keyword, after the caller's preset filter. */
  vacancyCount: Schema.Int,
  /** Vacancies that list this keyword among their hh skills, after the caller's preset filter. */
  skillVacancyCount: Schema.Int,
  /** hh accounts whose resume title, text or about contain this keyword. */
  resumeAccountIds: Schema.Array(HhAccountId),
  /** hh accounts whose resume skills list contains this keyword. */
  resumeSkillAccountIds: Schema.Array(HhAccountId),
  /** Resumes (per resume, not per account) whose title, text or about contain this keyword. */
  resumeIds: Schema.Array(ResumeId),
  /** Resumes whose skills list contains this keyword. */
  resumeSkillIds: Schema.Array(ResumeId),
  aliases: Schema.Array(KeywordAliasRecord),
  aliasStats: Schema.Array(KeywordAliasStat)
})

export type LexiconKeyword = typeof LexiconKeyword.Type

export const DecisionReason = Schema.Struct({
  code: DecisionReasonCode,
  detail: Schema.optional(Schema.String),
  weight: Schema.optional(Schema.Number)
})

export type DecisionReason = typeof DecisionReason.Type

export const DecisionRecord = Schema.Struct({
  id: DecisionId,
  userId: UserId,
  hhAccountId: Schema.optional(Schema.NullOr(HhAccountId)),
  resumeId: Schema.optional(Schema.NullOr(ResumeId)),
  vacancyId: VacancyId,
  vacancyTitle: Schema.optional(Schema.String),
  verdict: DecisionVerdict,
  fit: Schema.Int,
  priority: Schema.Number,
  reasons: Schema.Array(DecisionReason),
  policyVersion: Schema.Int,
  createdAt: Schema.String
})

export type DecisionRecord = typeof DecisionRecord.Type

/**
 * Outcome of one batch evaluation. `byReason` counts the primary (first)
 * reason code of every decision made in the batch.
 */
export const EvaluateBatchResult = Schema.Struct({
  /** Vacancies that went through the decision cascade in this call. */
  evaluated: Schema.Int,
  apply: Schema.Int,
  draft: Schema.Int,
  skip: Schema.Int,
  /** Vacancies that still lack a current decision after this call. */
  remaining: Schema.Int,
  byReason: Schema.Record(Schema.String, Schema.Int)
})

export type EvaluateBatchResult = typeof EvaluateBatchResult.Type

/* -------------------------------------------------------------------------- */
