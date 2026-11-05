import type {
  AnalysisLevel,
  AnalysisRole,
  Seniority,
  VacancyAnalysisFacts
} from "@otbor/contract"
import { ANALYSIS_THRESHOLD } from "./questions.ts"

/**
 * The part of a stored analysis the decision cascade reads. `decide` stays pure:
 * the cloud projects a stored row into this shape and passes it in.
 */
export interface DecisionAnalysis {
  readonly isIt: VacancyAnalysisFacts["isIt"]
  readonly role: VacancyAnalysisFacts["role"]
  readonly requiredLevel: VacancyAnalysisFacts["requiredLevel"]
}

export const toDecisionAnalysis = (facts: VacancyAnalysisFacts): DecisionAnalysis => ({
  isIt: facts.isIt,
  role: facts.role,
  requiredLevel: facts.requiredLevel
})

/** Roles the analysis may promote an `unknown` title to a passing title. */
export const PROMOTABLE_ROLES: ReadonlyArray<AnalysisRole> = ["devops", "sre", "platform"]

const confident = (fact: { readonly confidence: number } | null): boolean =>
  fact !== null && fact.confidence >= ANALYSIS_THRESHOLD

/**
 * An IT vacancy that the model confidently places in a devops-like role. Only
 * ever used to widen the title rules of the apply filter.
 */
export const analysisRoleMatch = (
  analysis: DecisionAnalysis | null | undefined
): { readonly role: AnalysisRole; readonly confidence: number } | null => {
  if (analysis === null || analysis === undefined) return null
  const { isIt, role } = analysis
  if (isIt === null || role === null) return null
  if (!isIt.value || !confident(isIt) || !confident(role)) return null
  return PROMOTABLE_ROLES.includes(role.value)
    ? { role: role.value, confidence: role.confidence }
    : null
}

export const seniorityOfLevel = (level: AnalysisLevel): Seniority => {
  switch (level) {
    case "intern":
    case "junior":
      return "junior"
    case "middle":
      return "middle"
    case "senior":
    case "staff":
      return "senior"
    case "tech_lead":
    case "team_lead":
    case "head":
      return "lead"
  }
}

/**
 * The required level as a seniority, but only to fill a gap: a seniority the
 * title or text already gave is never overridden.
 */
export const analysisSeniority = (
  stored: Seniority,
  analysis: DecisionAnalysis | null | undefined
): { readonly level: AnalysisLevel; readonly seniority: Seniority; readonly confidence: number } | null => {
  if (stored !== "unknown" || analysis === null || analysis === undefined) return null
  const level = analysis.requiredLevel
  if (level === null || !confident(level)) return null
  return { level: level.value, seniority: seniorityOfLevel(level.value), confidence: level.confidence }
}
