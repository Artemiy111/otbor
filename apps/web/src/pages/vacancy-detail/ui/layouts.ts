export const LAYOUTS = [
  { id: "desk", label: "Две колонки", hint: "Вакансия слева, отклик справа" },
  { id: "focus", label: "Отклик в фокусе", hint: "Отклик крупно, вакансия кратко" }
] as const

export type LayoutId = (typeof LAYOUTS)[number]["id"]
