export const analysisKeys = {
  all: ["analysis"] as const,
  insights: (days: number) => ["analysis", "insights", days] as const
}
