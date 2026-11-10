import type { ApplyFilterSource, ApplySort, AutoMode, SortDirection, TestsPolicy } from "@otbor/contract"

export const applyFilterKeys = {
  all: ["apply-filter"] as const,
  usage: (hhAccountId: string) => ["apply-filter", "usage", hhAccountId] as const,
  get: (hhAccountId: string, resumeId: string | null) =>
    ["apply-filter", "get", hhAccountId, resumeId ?? "account"] as const
}

/** Чей фильтр действует для пары «аккаунт + резюме», человеческими словами. */
export const applyFilterSourceLabel = (source: ApplyFilterSource, resumeSelected: boolean): string =>
  source === "exact"
    ? resumeSelected
      ? "Свой фильтр для этого резюме"
      : "Общий фильтр аккаунта"
    : source === "account"
      ? "Общий фильтр аккаунта"
      : "Фильтр по умолчанию — ещё не настраивали"

/** Что будет, если сохранить: пояснение к бейджу источника; пусто, когда пояснять нечего. */
export const applyFilterSourceHint = (source: ApplyFilterSource, resumeSelected: boolean): string =>
  source === "exact"
    ? ""
    : source === "account"
      ? resumeSelected
        ? "Для этого резюме своего фильтра нет, действует общий фильтр аккаунта. Сохранение создаст отдельный фильтр резюме с теми же настройками автооткликов."
        : ""
      : "Фильтр ещё не настраивали: действует встроенный набор правил. Сохранение создаст запись."

export const testsPolicyOptions: ReadonlyArray<{ value: TestsPolicy; label: string }> = [
  { value: "human", label: "Передавать человеку" },
  { value: "allow", label: "Заполнять автоматически" },
  { value: "skip", label: "Пропускать вакансии с тестом" }
]

export const autoModeOptions: ReadonlyArray<{
  value: AutoMode
  label: string
  /** Одна строка о последствиях режима. */
  consequence: string
}> = [
  { value: "off", label: "Выключено", consequence: "Ничего не создаётся." },
  { value: "drafts", label: "Черновики", consequence: "Система готовит письмо и ответы, отправляете вы." },
  { value: "auto", label: "Авто", consequence: "Система отправляет сама в пределах дневного лимита." }
]

export const sortDirectionOptions: ReadonlyArray<{ value: SortDirection; label: string }> = [
  { value: "desc", label: "Лучшие первыми" },
  { value: "asc", label: "Худшие первыми" }
]

export const applySortOptions: ReadonlyArray<{ value: ApplySort; label: string }> = [
  { value: "priority", label: "По приоритету" },
  { value: "fit", label: "По соответствию" },
  { value: "newest", label: "Сначала новые" },
  { value: "salary", label: "По зарплате" }
]
