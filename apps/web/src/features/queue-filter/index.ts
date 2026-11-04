import type { HeaderFilterOption } from "@/shared/ui"

export const queueStatusOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все статусы" },
  { value: "pending", label: "Ожидает (pending)" },
  { value: "leased", label: "Взят в работу (leased)" },
  { value: "running", label: "Выполняется (running)" },
  { value: "done", label: "Готово (done)" },
  { value: "failed", label: "Ошибка (failed)" },
  { value: "dead", label: "Исчерпан (dead)" },
  { value: "needs_human", label: "Нужен человек (needs_human)" },
  { value: "needs_reconcile", label: "Нужна сверка (needs_reconcile)" },
  { value: "cancelled", label: "Отменён (cancelled)" }
]
