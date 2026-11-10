import type { HeaderFilterOption } from "@/shared/ui"

export type QueueTab = "browser" | "inference" | "background"

/** Фильтр страницы «Очереди»; живёт в адресе: `?tab=&status=&stage=`. */
export interface QueueFilter {
  readonly tab: QueueTab
  /** Статусы задач; пусто - любые. */
  readonly status: ReadonlyArray<string>
  /** Стадии задач; пусто - любые. */
  readonly stage: ReadonlyArray<string>
}

const TABS: ReadonlyArray<QueueTab> = ["browser", "inference", "background"]
const STATUSES = ["pending", "leased", "running", "done", "failed", "dead", "needs_human", "needs_reconcile", "cancelled"]
const STAGES = [
  "prepare",
  "submit",
  "reconcile",
  "session",
  "inference",
  "negotiations_sync",
  "resume_sync",
  "form_read",
  "letter_attach",
  "chat_read",
  "resume_bump"
]

/** Значение выпадающего списка: несколько кодов через запятую. */
export const valueList = (value: string): ReadonlyArray<string> =>
  value === "" || value === "all" ? [] : value.split(",").filter((item) => item !== "")

const known = (value: string | null, allowed: ReadonlyArray<string>): ReadonlyArray<string> =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, list) => allowed.includes(item) && list.indexOf(item) === index)

export const parseQueueFilter = (search: string): QueueFilter => {
  const params = new URLSearchParams(search)
  const tab = params.get("tab")
  return {
    tab: TABS.find((item) => item === tab) ?? "browser",
    status: known(params.get("status"), STATUSES),
    stage: known(params.get("stage"), STAGES)
  }
}

export const queueFilterSearch = (filter: QueueFilter): string => {
  const params = new URLSearchParams()
  if (filter.tab !== "browser") params.set("tab", filter.tab)
  if (filter.status.length > 0) params.set("status", filter.status.join(","))
  if (filter.stage.length > 0) params.set("stage", filter.stage.join(","))
  return params.toString()
}

/**
 * Состояния для выпадающего списка: по смыслу, без служебных кодов. Группа
 * несёт сразу несколько статусов (значение - коды через запятую).
 */
export const queueStatusOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "all", label: "Все состояния" },
  { value: "pending", label: "Ожидает" },
  { value: "leased,running", label: "Выполняется" },
  { value: "needs_human,needs_reconcile", label: "Нужен человек или проверка" },
  { value: "failed,dead", label: "Ошибка" },
  { value: "done", label: "Готово" },
  { value: "cancelled", label: "Отменён" }
]

const STAGE_OPTIONS: Readonly<Record<"browser" | "inference", ReadonlyArray<HeaderFilterOption>>> = {
  browser: [
    { value: "all", label: "Все задачи" },
    { value: "prepare", label: "Подготовка отклика" },
    { value: "submit", label: "Отправка отклика" },
    { value: "reconcile", label: "Проверка отправки" },
    { value: "form_read", label: "Чтение формы" },
    { value: "letter_attach", label: "Письмо к отклику" },
    { value: "session", label: "Вход в hh" },
    { value: "negotiations_sync", label: "Статусы откликов" },
    { value: "resume_sync", label: "Загрузка резюме" },
    { value: "chat_read", label: "Чтение чатов" },
    { value: "resume_bump", label: "Подъём резюме" }
  ],
  inference: [
    { value: "all", label: "Все задачи" },
    { value: "inference", label: "Генерация текста" }
  ]
}

export const queueStageOptions = (kind: "browser" | "inference"): ReadonlyArray<HeaderFilterOption> =>
  STAGE_OPTIONS[kind]
