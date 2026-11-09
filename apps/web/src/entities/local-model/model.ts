export const localModelKeys = {
  all: ["local-models"] as const,
  health: () => [...localModelKeys.all, "health"] as const,
  captcha: () => [...localModelKeys.all, "captcha"] as const,
  list: () => [...localModelKeys.all, "list"] as const
}
