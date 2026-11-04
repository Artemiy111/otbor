import type { HeaderFilterOption } from "@/shared/ui"

export const vacancyGateOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все вердикты" },
  { value: "match", label: "Подходит (match)" },
  { value: "unknown", label: "Неясно (unknown)" },
  { value: "reject", label: "Отклонено (reject)" }
]

export const vacancyArchiveOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "active", label: "Только активные" },
  { value: "all", label: "С архивными" }
]
