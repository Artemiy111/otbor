export const telegramAccountKeys = {
  all: ["telegram-accounts"] as const,
  list: () => ["telegram-accounts", "list"] as const,
  login: (id: string) => ["telegram-accounts", "login", id] as const
}
