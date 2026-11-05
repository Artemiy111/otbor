import { APPLY_POLICY_VERSION } from "./decision.ts"

/** What a stored decision remembers about the inputs it was made from. */
export interface DecisionFingerprint {
  /** `vacancy.content_hash` at decision time; null for rows that predate it. */
  readonly vacancyContentHash: string | null
  readonly policyVersion: number
}

/** What a decision made right now would be based on. */
export interface CurrentFingerprint {
  readonly contentHash: string
  readonly policyVersion: number
}

export const currentVersions = {
  policyVersion: APPLY_POLICY_VERSION
} as const

/**
 * A vacancy needs a (new) decision when it has none, or when the latest one
 * was made for other vacancy content (search card, hydration or a repeat
 * crawl changed `content_hash`) or another apply policy version. A filter edit
 * does not show up here: the filter hash is part of the decision input hash.
 *
 * The cloud mirrors this predicate in SQL (`DecisionRepository.staleVacancies`)
 * so a sweep over thousands of vacancies does not load them one by one; the
 * integration suite checks both agree.
 */
export const isDecisionStale = (
  latest: DecisionFingerprint | null,
  current: CurrentFingerprint
): boolean => {
  if (latest === null) return true
  if (latest.vacancyContentHash === null) return true
  if (latest.vacancyContentHash !== current.contentHash) return true
  return latest.policyVersion !== current.policyVersion
}
