import type { HeaderFilterOption } from "@/shared/ui"

export const applicationStateOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все состояния" },
  { value: "draft", label: "Черновик (draft)" },
  { value: "queued", label: "В очереди (queued)" },
  { value: "submitting", label: "Отправляется (submitting)" },
  { value: "submitted", label: "Отправлен (submitted)" },
  { value: "skipped", label: "Пропущен (skipped)" },
  { value: "needs_human", label: "Нужен человек (needs_human)" },
  { value: "failed", label: "Ошибка (failed)" }
]
