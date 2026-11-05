import type { ApplyFilterSource, ApplySort, AutoMode, TestsPolicy } from "@otbor/contract"

export const applyFilterKeys = {
  all: ["apply-filter"] as const,
  usage: (hhAccountId: string) => ["apply-filter", "usage", hhAccountId] as const,
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

export const autoModeOptions: ReadonlyArray<{ value: AutoMode; label: string; hint: string }> = [
  { value: "off", label: "Выкл", hint: "Ничего не создаётся и не отправляется. Режим по умолчанию." },
  {
    value: "drafts",
    label: "Черновики",
    hint: "Создаёт отклики, читает форму, пишет письмо и ответы и оставляет черновик. Отправляете вы."
  },
  {
    value: "auto",
    label: "Отправка",
    hint: "То же, но готовый отклик, прошедший все проверки, уходит на hh.ru сам. Это необратимо."
  }
]

export const applySortOptions: ReadonlyArray<{ value: ApplySort; label: string }> = [
  { value: "priority", label: "По приоритету" },
  { value: "fit", label: "По соответствию" },
  { value: "newest", label: "Сначала новые" },
  { value: "salary", label: "По зарплате" }
]
