export const applicationKeys = {
  all: ["applications"] as const,
  list: (state: string, account = "all") => ["applications", "list", state, account] as const,
  detail: (id: string) => ["applications", "detail", id] as const
}
