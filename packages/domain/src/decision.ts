import type {
  DecisionReason,
  DecisionVerdict,
  GateVerdict,
  RoleFamily,
  Seniority,
  TestsPolicy,
  WorkFormat
} from "@otbor/contract"
import { analysisSeniority, type DecisionAnalysis } from "./analysis/decision.ts"
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

/**
 * State that is not a property of the vacancy and so cannot be a filter rule.
 * Everything else that blocks (salary, format, level, title, archive,
 * blacklist, hidden) is the apply filter.
 */
export interface HardBlockInput {
  readonly applied: boolean
  readonly hasTest: boolean
  readonly testRequired: boolean
}

/** The outcome of evaluating an apply filter against one vacancy. */
export interface FilterOutcome {
  readonly passed: boolean
  /** Readable labels of the rules and OR groups that failed, empty when `passed`. */
  readonly failed: ReadonlyArray<string>
}

/** Scoring settings stored next to the apply filter. */
export interface DecisionSettings {
  readonly minFit: number
  readonly tests: TestsPolicy
  readonly freshHalfLifeHours: number
}

/**
 * Version of the decision logic (not of the filter: a filter edit changes the
 * input hash instead). Bump it when `decide` itself changes.
 */
export const APPLY_POLICY_VERSION = 2

/**
 * Scoring constants. They only rank; they never block. They are the former
 * default policy's numbers, kept so a fit does not move when the filter does.
 */
const FIT_SALARY_FLOOR = 250_000
const FIT_SENIORITY: ReadonlyArray<Seniority> = ["middle", "senior", "lead", "unknown"]

export interface DecideInput {
  readonly vacancy: VacancySignal
  readonly filter: FilterOutcome
  readonly settings: DecisionSettings
  readonly keywords: ReadonlyArray<LexiconMatch>
  readonly blocks: HardBlockInput
  /**
   * The stored vacancy analysis, when there is one for the current prompt
   * version. It only fills an `unknown` seniority for scoring.
   */
  readonly analysis?: DecisionAnalysis | null
  /** An LLM fit, when one has been computed. Deterministic fit is used otherwise. */
  readonly fitOverride?: number
  readonly now: Date
}

export interface DecisionResult {
  readonly verdict: DecisionVerdict
  /** `match` when the filter passed, `unknown` otherwise (stage 1 keeps the column). */
  readonly gate: GateVerdict
  readonly roleFamily: RoleFamily | null
  readonly fit: number
  readonly priority: number
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policyVersion: number
  /** Always 0: no gate rules are involved any more. */
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

const salaryMeets = (vacancy: VacancySignal, threshold: number | null): boolean => {
  if (threshold === null) return false
  if (vacancy.salaryCurrency !== null && vacancy.salaryCurrency !== "RUB") return false
  return (
    (vacancy.salaryFrom !== null && vacancy.salaryFrom >= threshold) ||
    (vacancy.salaryTo !== null && vacancy.salaryTo >= threshold)
  )
}

const testsPass = (blocks: HardBlockInput, policy: TestsPolicy): boolean => {
  if (!blocks.hasTest) return true
  if (policy === "allow") return true
  if (policy === "skip") return false
  return !blocks.testRequired
}

const computeFit = (
  input: DecideInput,
  seniority: Seniority,
  titleHits: ReadonlyArray<string>,
  bodyHits: ReadonlyArray<string>
): number => {
  if (input.fitOverride !== undefined) {
    return Math.max(0, Math.min(100, Math.round(input.fitOverride)))
  }

  const skillHits = matchedTerms(input.keywords, "skills")
  const salary = salaryMeets(input.vacancy, FIT_SALARY_FLOOR)
  const remote = input.vacancy.workFormats.includes("remote")

  let fit = 45
  fit += Math.min(3, titleHits.length) * 7
  fit += Math.min(3, bodyHits.length) * 5
  fit += Math.min(2, skillHits.length) * 6
  if (salary) fit += 8
  if (remote) fit += 5
  if (FIT_SENIORITY.includes(seniority)) fit += 4

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
 * Two blocks are state, not vacancy properties: an earlier application with
 * this resume, and the tests policy. Between them sits the apply filter (a
 * `PresetFilter` evaluated in SQL), which answers "may we apply to this
 * vacancy at all"; a failing filter is a skip whose reason names the failed
 * rules. Fit is only a ranking signal and a low-fit floor.
 */
export const decide = (input: DecideInput): DecisionResult => {
  const { blocks, settings } = input

  // Seniority only fills a gap: a stored value is never overridden.
  const levelFact = analysisSeniority(input.vacancy.seniority, input.analysis)
  const vacancy: VacancySignal = levelFact === null
    ? input.vacancy
    : { ...input.vacancy, seniority: levelFact.seniority }
  const levelDetail = levelFact === null
    ? null
    : `analysis: ${levelFact.level} -> ${levelFact.seniority} (${levelFact.confidence.toFixed(2)})`

  const gate: GateVerdict = input.filter.passed ? "match" : "unknown"

  const skip = (blocked: DecisionReason, fit = 0): DecisionResult => ({
    verdict: "skip",
    gate,
    roleFamily: null,
    fit,
    priority: 0,
    reasons: [blocked],
    policyVersion: APPLY_POLICY_VERSION,
    rulesVersion: 0
  })

  // Applied first: it is a fact about this account and resume, true whatever
  // the filter says now, and it keeps an applied vacancy labelled as such.
  if (blocks.applied) return skip(reason("blocked_applied", "already applied"))
  if (!input.filter.passed) {
    return skip(reason("blocked_filter", input.filter.failed.join(", ")))
  }
  if (!testsPass(blocks, settings.tests)) {
    return skip(reason("blocked_test", blocks.testRequired ? "mandatory test" : "test policy"))
  }

  const titleHits = matchedTerms(input.keywords, "title")
  const bodyHits = matchedTerms(input.keywords, "body")

  const fit = computeFit(input, vacancy.seniority, titleHits, bodyHits)
  if (fit < settings.minFit) {
    return skip(reason("blocked_low_fit", `fit ${fit} < ${settings.minFit}`), fit)
  }

  const { freshness, ageHours } = computeFreshness(
    vacancy.publishedAt,
    input.now,
    settings.freshHalfLifeHours
  )
  const priority = Math.round(fit * freshness * 100) / 100

  const fitSource = input.fitOverride !== undefined ? "llm" : "deterministic"
  const reasons: DecisionReason[] = [reason("fit", `${fitSource} ${fit}`, fit / 100)]

  if (titleHits.length > 0) {
    reasons.push(reason("skill_match", `title: ${titleHits.join(", ")}`, titleHits.length))
  }
  if (bodyHits.length > 0) {
    reasons.push(reason("skill_match", `body: ${bodyHits.join(", ")}`, bodyHits.length))
  }
  if (salaryMeets(vacancy, FIT_SALARY_FLOOR)) {
    reasons.push(reason("salary", `${FIT_SALARY_FLOOR}+`, 1))
  }
  if (vacancy.workFormats.includes("remote")) {
    reasons.push(reason("remote", "remote", 1))
  }
  if (levelDetail !== null) reasons.push(reason("seniority", levelDetail, 1))
  reasons.push(
    reason("freshness", ageHours === null ? "unknown" : `${Math.round(ageHours)}h old`, freshness)
  )

  return {
    verdict: "apply",
    gate,
    roleFamily: null,
    fit,
    priority,
    reasons,
    policyVersion: APPLY_POLICY_VERSION,
    rulesVersion: 0
  }
}
