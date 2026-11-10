export const personKeys = {
  all: ["people"] as const,
  list: (query: string) => ["people", "list", query] as const,
  detail: (id: string) => ["people", "detail", id] as const
}

/** Уверенность может прийти долей (0.9) или процентами (90): приводим к целым процентам. */
export const confidencePercent = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? null : Math.round(value <= 1 ? value * 100 : value)

const LINK_LABELS: Record<string, string> = {
  auto: "определён автоматически",
  suggested: "предложен, нужна проверка",
  manual: "подтверждён вручную"
}

/** Как контакт связан с человеком: «определён автоматически · 90%». */
export const contactLinkText = (link: string | null, confidence: number | null): string => {
  const percent = confidencePercent(confidence)
  const head = link === null ? "не привязан" : (LINK_LABELS[link] ?? link)
  return percent === null ? head : `${head} · ${percent}%`
}
