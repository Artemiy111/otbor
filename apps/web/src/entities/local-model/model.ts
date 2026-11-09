export const localModelKeys = {
  all: ["local-models"] as const,
  health: () => [...localModelKeys.all, "health"] as const,
  list: () => [...localModelKeys.all, "list"] as const
}
