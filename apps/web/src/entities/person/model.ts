export const personKeys = {
  all: ["people"] as const,
  list: (query: string) => ["people", "list", query] as const,
  detail: (id: string) => ["people", "detail", id] as const
}
