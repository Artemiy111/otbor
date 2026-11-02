export const vacancyKeys = {
  all: ["vacancies"] as const,
  list: (params: { readonly offset: number; readonly gate: string }) =>
    ["vacancies", "list", params] as const,
  detail: (id: string) => ["vacancies", "detail", id] as const
}
