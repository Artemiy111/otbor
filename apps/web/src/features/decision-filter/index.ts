import type { HeaderFilterOption } from "@/shared/ui"

export const decisionVerdictOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все вердикты" },
  { value: "apply", label: "Откликаться (apply)" },
  { value: "draft", label: "Черновик (draft)" },
  { value: "skip", label: "Пропуск (skip)" }
]
