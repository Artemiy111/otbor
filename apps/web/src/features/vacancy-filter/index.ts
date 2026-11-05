import type { HeaderFilterOption } from "@/shared/ui"

export const vacancyAnalysedOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все" },
  { value: "yes", label: "Проанализированы" },
  { value: "no", label: "Не проанализированы" }
]

export const vacancyArchiveOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "active", label: "Только активные" },
  { value: "all", label: "С архивными" }
]
