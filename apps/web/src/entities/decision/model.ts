export const decisionKeys = {
  all: ["decisions"] as const,
  /** Решения одной вакансии: узкая выборка по её названию и работодателю. */
  vacancy: (id: string) => ["decisions", "vacancy", id] as const,
  list: (verdict: string, account = "all") => ["decisions", "list", verdict, account] as const
}
