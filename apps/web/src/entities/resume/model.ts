export const resumeKeys = {
  all: ["resumes"] as const,
  list: (accountId?: string) => ["resumes", "list", accountId ?? "all"] as const,
  detail: (id: string) => ["resumes", "detail", id] as const,
  enrichment: (id: string) => ["resumes", "enrichment", id] as const
}
