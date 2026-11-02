export const applicationKeys = {
  all: ["applications"] as const,
  list: (state: string) => ["applications", "list", state] as const,
  detail: (id: string) => ["applications", "detail", id] as const
}
