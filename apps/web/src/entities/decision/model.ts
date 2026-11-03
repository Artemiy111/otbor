export const decisionKeys = {
  all: ["decisions"] as const,
  list: (verdict: string, account = "all") => ["decisions", "list", verdict, account] as const
}
