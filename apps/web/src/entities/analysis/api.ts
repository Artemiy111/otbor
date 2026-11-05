import type { AnalysisInsights } from "@otbor/contract"
import { call } from "@/shared/api"

export const analysisApi = {
  insights: (days: number): Promise<AnalysisInsights> => call((client) => client.AnalysisInsightsGet({ days }))
}
