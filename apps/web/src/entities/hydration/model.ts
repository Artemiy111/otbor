export const hydrationKeys = {
  all: ["hydration"] as const,
  stats: () => [...hydrationKeys.all, "stats"] as const,
  proxyStatus: () => [...hydrationKeys.all, "proxy-status"] as const,
  vacancyTargets: () => [...hydrationKeys.all, "vacancy-targets"] as const,
  employerTargets: () => [...hydrationKeys.all, "employer-targets"] as const
}
