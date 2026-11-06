import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import {
  AnalysisInsights,
  AnalysisRunInput,
  AnalysisRunResult,
  AnalysisStats,
  VacancyAnalysis
} from "../analysis.ts"
import { ApiError } from "../errors.ts"
import { PresetId, VacancyId } from "../ids.ts"
import { MarketAnalytics } from "../market.ts"

/** The stored model analysis of a vacancy (default prompt version), or null when it was not analysed yet. */
export const VacancyAnalysisGet = Rpc.make("VacancyAnalysisGet", {
  payload: Schema.Struct({ vacancyId: VacancyId }),
  success: Schema.NullOr(VacancyAnalysis),
  error: ApiError
})

/** One bounded pass of the local model over vacancies without a current analysis. Waits for the pass. */
export const AnalysisRun = Rpc.make("AnalysisRun", {
  payload: AnalysisRunInput,
  success: AnalysisRunResult,
  error: ApiError
})

export const AnalysisStatsGet = Rpc.make("AnalysisStatsGet", {
  success: AnalysisStats,
  error: ApiError
})

export const AnalysisInsightsGet = Rpc.make("AnalysisInsightsGet", {
  payload: Schema.Struct({ days: Schema.optional(Schema.Int) }),
  success: AnalysisInsights,
  error: ApiError
})

export const MarketAnalyticsGet = Rpc.make("MarketAnalyticsGet", {
  payload: Schema.Struct({
    /** Narrow the selection with this preset's filter. */
    presetId: Schema.optional(PresetId),
    /** Only vacancies published in the last N days; omit for all time. */
    sinceDays: Schema.optional(Schema.Int),
    /** Salary currency, ISO code; default RUB. */
    currency: Schema.optional(Schema.String)
  }),
  success: MarketAnalytics,
  error: ApiError
})
