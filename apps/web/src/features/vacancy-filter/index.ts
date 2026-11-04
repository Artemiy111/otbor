import type { HeaderFilterOption } from "@/shared/ui"

export const vacancyGateOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все вердикты" },
  { value: "match", label: "Подходит (match)" },
  { value: "unknown", label: "Неясно (unknown)" },
  { value: "reject", label: "Отклонено (reject)" }
]

export const vacancyAnalysedOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все" },
  { value: "yes", label: "Проанализированы" },
  { value: "no", label: "Не проанализированы" }
]

export const vacancyArchiveOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "active", label: "Только активные" },
  { value: "all", label: "С архивными" }
]
