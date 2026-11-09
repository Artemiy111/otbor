export const localModelKeys = {
  all: ["local-models"] as const,
  list: () => [...localModelKeys.all, "list"] as const
}
