import { APPLY_POLICY_VERSION } from "./decision.ts"
import { DEVOPS_GATE_POLICY } from "./gate.ts"

/** What a stored decision remembers about the inputs it was made from. */
export interface DecisionFingerprint {
  /** `vacancy.content_hash` at decision time; null for rows that predate it. */
  readonly vacancyContentHash: string | null
  readonly policyVersion: number
  /** 0 for a decision that followed a user verdict, which no rules edit outranks. */
  readonly rulesVersion: number
}

/** What a decision made right now would be based on. */
export interface CurrentFingerprint {
  readonly contentHash: string
  readonly policyVersion: number
  readonly rulesVersion: number
}

export const currentVersions = {
  policyVersion: APPLY_POLICY_VERSION,
  rulesVersion: DEVOPS_GATE_POLICY.version
} as const

/**
 * A vacancy needs a (new) decision when it has none, or when the latest one
 * was made for other vacancy content (search card, hydration or a repeat
 * crawl changed `content_hash`), another apply policy version, or older gate
 * rules. `rulesVersion === 0` marks a user verdict: those never go stale on a
 * rules bump, because the user's word outranks every rules version.
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
  if (latest.policyVersion !== current.policyVersion) return true
  return latest.rulesVersion !== 0 && latest.rulesVersion < current.rulesVersion
}
