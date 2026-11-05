import type { ApplyFilterSource, TestsPolicy } from "@otbor/contract"

export const applyFilterKeys = {
  all: ["apply-filter"] as const,
  get: (hhAccountId: string, resumeId: string | null) =>
    ["apply-filter", "get", hhAccountId, resumeId ?? "account"] as const
}

export const applyFilterSourceLabel = (source: ApplyFilterSource): string =>
  source === "exact"
    ? "Фильтр этого резюме"
    : source === "account"
      ? "Фильтр аккаунта по умолчанию"
      : "Встроенный фильтр по умолчанию"

export const testsPolicyOptions: ReadonlyArray<{ value: TestsPolicy; label: string }> = [
  { value: "human", label: "Передавать человеку" },
  { value: "allow", label: "Заполнять автоматически" },
  { value: "skip", label: "Пропускать вакансии с тестом" }
]
