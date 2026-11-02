export const decisionKeys = {
  all: ["decisions"] as const,
  list: (verdict: string) => ["decisions", "list", verdict] as const
}
