import type {
  BlacklistScope,
  BlacklistTarget,
  DecisionReason,
  DecisionVerdict,
  GateVerdict,
  RoleFamily,
  Seniority,
  TestsPolicy,
  WorkFormat
} from "@otbor/contract"
import { normalizeTerm } from "./text.ts"
import type { LexiconMatch } from "./lexicon.ts"
import { matchedTerms } from "./lexicon.ts"

export interface VacancySignal {
  readonly id: string
  readonly title: string
  readonly archived: boolean
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly workFormats: ReadonlyArray<WorkFormat>
  readonly seniority: Seniority
  readonly publishedAt: string | null
  readonly employerId: string | null
  readonly employerName: string | null
  readonly skills: ReadonlyArray<string>
  readonly descriptionText: string
}

export interface HardBlockInput {
  readonly hidden: boolean
  /** Set only when the caller did not explicitly include blacklisted rows. */
  readonly blacklist?: {
    readonly scope: BlacklistScope
    readonly target: BlacklistTarget
  } | null
  readonly applied: boolean
  readonly employerCooldown: boolean
  readonly hasTest: boolean
  readonly testRequired: boolean
}

/**
 * A preset narrowed to the apply use case.
 *
 * `explore` presets may be wide; this one is deliberately small. Every field
 * here either blocks or ranks; nothing is stored just for the UI.
 */
export interface ApplyPolicy {
  readonly version: number
  readonly role: RoleFamily
  readonly salaryFrom: number | null
  readonly workFormats: ReadonlyArray<WorkFormat>
  readonly excludeApplied: boolean
  readonly tests: TestsPolicy
  readonly minFit: number
  readonly titleKeywords: ReadonlyArray<string>
  readonly bodyKeywords: ReadonlyArray<string>
  readonly excludeKeywords: ReadonlyArray<string>
  readonly seniority: ReadonlyArray<Seniority>
  readonly freshHalfLifeHours: number
}

export const DEFAULT_APPLY_POLICY: ApplyPolicy = {
  version: 1,
  role: "devops",
  salaryFrom: 250_000,
  workFormats: ["remote", "hybrid"],
  excludeApplied: true,
  tests: "human",
  minFit: 45,
  titleKeywords: [],
  bodyKeywords: [],
  excludeKeywords: [],
  seniority: ["middle", "senior", "lead", "unknown"],
  freshHalfLifeHours: 72
}

export interface DecideInput {
  readonly vacancy: VacancySignal
  readonly gate: {
    readonly verdict: GateVerdict
    readonly roleFamily: RoleFamily | null
    readonly rejectedBy: string | null
    readonly rulesVersion: number
    readonly weak: ReadonlyArray<string>
  }
  readonly keywords: ReadonlyArray<LexiconMatch>
  readonly blocks: HardBlockInput
  readonly policy?: ApplyPolicy
  /** An LLM fit, when one has been computed. Deterministic fit is used otherwise. */
  readonly fitOverride?: number
  readonly now: Date
}

export interface DecisionResult {
  readonly verdict: DecisionVerdict
  readonly gate: GateVerdict
  readonly roleFamily: RoleFamily | null
  readonly fit: number
  readonly priority: number
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policyVersion: number
  readonly rulesVersion: number
}

const reason = (
  code: DecisionReason["code"],
  detail?: string,
  weight?: number
): DecisionReason => ({
  code,
  ...(detail === undefined ? {} : { detail }),
  ...(weight === undefined ? {} : { weight })
})

const normalizedSet = (values: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(values.map(normalizeTerm))

const intersectionCount = (
  actual: ReadonlyArray<string>,
  allowed: ReadonlySet<string>
): number => actual.filter((value) => allowed.has(value)).length

const salaryPasses = (vacancy: VacancySignal, threshold: number | null): boolean => {
  if (threshold === null) return true
  // A foreign currency needs a rate before it can be compared. Do not block on
  // a comparison we cannot make; the UI shows the original amount.
  if (vacancy.salaryCurrency !== null && vacancy.salaryCurrency !== "RUB") return true
  // An open-ended "from 100 000" may still reach the threshold. Only a known
  // upper bound below the floor is a hard block.
  if (vacancy.salaryTo !== null) return vacancy.salaryTo >= threshold
  return true
}

const salaryMeets = (vacancy: VacancySignal, threshold: number | null): boolean => {
  if (threshold === null) return false
  if (vacancy.salaryCurrency !== null && vacancy.salaryCurrency !== "RUB") return false
  return (
    (vacancy.salaryFrom !== null && vacancy.salaryFrom >= threshold) ||
    (vacancy.salaryTo !== null && vacancy.salaryTo >= threshold)
  )
}

const workFormatPasses = (
  vacancy: VacancySignal,
  allowed: ReadonlyArray<WorkFormat>
): boolean => {
  if (allowed.length === 0) return true
  if (vacancy.workFormats.length === 0) return true
  if (vacancy.workFormats.includes("unknown")) return true
  return vacancy.workFormats.some((format) => allowed.includes(format))
}

const testsPass = (blocks: HardBlockInput, policy: TestsPolicy): boolean => {
  if (!blocks.hasTest) return true
  if (policy === "allow") return true
  if (policy === "skip") return false
  return !blocks.testRequired
}

const computeFit = (
  input: DecideInput,
  policy: ApplyPolicy,
  titleHits: ReadonlyArray<string>,
  bodyHits: ReadonlyArray<string>
): number => {
  if (input.fitOverride !== undefined) {
    return Math.max(0, Math.min(100, Math.round(input.fitOverride)))
  }

  const skillHits = matchedTerms(input.keywords, "skills")
  const salary = salaryMeets(input.vacancy, policy.salaryFrom)
  const remote = input.vacancy.workFormats.includes("remote")

  let fit = 45
  fit += Math.min(3, titleHits.length) * 7
  fit += Math.min(3, bodyHits.length) * 5
  fit += Math.min(2, skillHits.length) * 6
  if (salary) fit += 8
  if (remote) fit += 5
  if (policy.seniority.includes(input.vacancy.seniority)) fit += 4

  return Math.max(0, Math.min(100, Math.round(fit)))
}

const computeFreshness = (
  publishedAt: string | null,
  now: Date,
  halfLifeHours: number
): { freshness: number; ageHours: number | null } => {
  if (publishedAt === null) return { freshness: 0.5, ageHours: null }
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) return { freshness: 0.5, ageHours: null }

  const ageHours = Math.max(0, (now.getTime() - published) / 3_600_000)
  const halfLife = Math.max(1, halfLifeHours)
  const freshness = Math.max(0.05, Math.min(1, 0.5 ** (ageHours / halfLife)))
  return { freshness, ageHours }
}

/**
 * The decision cascade.
 *
 * Hard blocks are checked first and are cheap. The role gate is next, and no
 * LLM is involved: "is this a DevOps vacancy" is answered by the title. Fit is
 * only a ranking signal after identity has been decided.
 *
 * `unknown` is a skip, not a draft: it must never consume an application or a
 * token. It stays visible in the quiet "maybe" list keyed by title verdict.
 */
export const decide = (input: DecideInput): DecisionResult => {
  const policy = input.policy ?? DEFAULT_APPLY_POLICY
  const { vacancy, gate, blocks } = input

  const gateReason: DecisionReason =
    gate.verdict === "reject"
      ? reason("role_rejected", gate.rejectedBy ?? "negative rule", 1)
      : gate.verdict === "unknown"
        ? reason(
            "role_unknown",
            gate.weak.length > 0 ? `weak: ${gate.weak.join(", ")}` : "no strong stem",
            0.5
          )
        : reason("role_match", gate.roleFamily ?? policy.role, 1)

  const hardBlock = (): DecisionReason | null => {
    if (vacancy.archived) return reason("blocked_archived", "vacancy is archived")
    if (blocks.hidden) return reason("blocked_hidden", "hidden by rule")
    if (blocks.blacklist !== undefined && blocks.blacklist !== null) {
      return reason(
        "blocked_blacklist",
        `${blocks.blacklist.target}:${blocks.blacklist.scope}`
      )
    }
    if (blocks.applied && policy.excludeApplied) return reason("blocked_applied", "already applied")
    if (blocks.employerCooldown) {
      return reason("blocked_employer_cooldown", vacancy.employerName ?? vacancy.employerId ?? undefined)
    }
    if (!testsPass(blocks, policy.tests)) {
      return reason("blocked_test", blocks.testRequired ? "mandatory test" : "test policy")
    }
    if (!salaryPasses(vacancy, policy.salaryFrom)) {
      return reason("blocked_salary", `upper bound below ${policy.salaryFrom}`)
    }
    if (!workFormatPasses(vacancy, policy.workFormats)) {
      return reason("blocked_work_format", vacancy.workFormats.join(", "))
    }
    return null
  }

  const blocked = hardBlock()
  if (blocked !== null) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [blocked, gateReason],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  if (gate.verdict !== "match") {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [gateReason],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  const titleHitsRaw = matchedTerms(input.keywords, "title")
  const bodyHitsRaw = matchedTerms(input.keywords, "body")
  const requiredTitle = normalizedSet(policy.titleKeywords)
  const requiredBody = normalizedSet(policy.bodyKeywords)
  const excluded = normalizedSet(policy.excludeKeywords)

  const titleHits =
    requiredTitle.size === 0
      ? titleHitsRaw
      : titleHitsRaw.filter((term) => requiredTitle.has(term))
  const bodyHits =
    requiredBody.size === 0
      ? bodyHitsRaw
      : bodyHitsRaw.filter((term) => requiredBody.has(term))

  if (requiredTitle.size > 0 && titleHits.length === 0) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [
        reason("blocked_keywords", `title needs one of: ${policy.titleKeywords.join(", ")}`),
        gateReason
      ],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  if (requiredBody.size > 0 && bodyHits.length === 0) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [
        reason("blocked_keywords", `body needs one of: ${policy.bodyKeywords.join(", ")}`),
        gateReason
      ],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  const excludedHit = [...titleHitsRaw, ...bodyHitsRaw].find((term) => excluded.has(term))
  if (excludedHit !== undefined) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [reason("blocked_keywords", `excluded term: ${excludedHit}`), gateReason],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  if (!policy.seniority.includes(vacancy.seniority)) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit: 0,
      priority: 0,
      reasons: [reason("blocked_seniority", vacancy.seniority), gateReason],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  const fit = computeFit(input, policy, titleHits, bodyHits)
  if (fit < policy.minFit) {
    return {
      verdict: "skip",
      gate: gate.verdict,
      roleFamily: gate.roleFamily,
      fit,
      priority: 0,
      reasons: [reason("blocked_low_fit", `fit ${fit} < ${policy.minFit}`), gateReason],
      policyVersion: policy.version,
      rulesVersion: gate.rulesVersion
    }
  }

  const { freshness, ageHours } = computeFreshness(
    vacancy.publishedAt,
    input.now,
    policy.freshHalfLifeHours
  )
  const priority = Math.round(fit * freshness * 100) / 100

  const fitSource = input.fitOverride !== undefined ? "llm" : "deterministic"
  const reasons: DecisionReason[] = [gateReason, reason("fit", `${fitSource} ${fit}`, fit / 100)]

  if (titleHits.length > 0) {
    reasons.push(reason("skill_match", `title: ${titleHits.join(", ")}`, titleHits.length))
  }
  if (bodyHits.length > 0) {
    reasons.push(reason("skill_match", `body: ${bodyHits.join(", ")}`, bodyHits.length))
  }
  if (salaryMeets(vacancy, policy.salaryFrom)) {
    reasons.push(reason("salary", `${policy.salaryFrom}+`, 1))
  }
  if (vacancy.workFormats.includes("remote")) {
    reasons.push(reason("remote", "remote", 1))
  }
  reasons.push(
    reason("freshness", ageHours === null ? "unknown" : `${Math.round(ageHours)}h old`, freshness)
  )

  return {
    verdict: "apply",
    gate: gate.verdict,
    roleFamily: gate.roleFamily,
    fit,
    priority,
    reasons,
    policyVersion: policy.version,
    rulesVersion: gate.rulesVersion
  }
}
