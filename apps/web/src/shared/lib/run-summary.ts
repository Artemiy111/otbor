/**
 * A run's `detail` as short Russian phrases. The raw detail is a bag of counters
 * written by different runners; the operator reads "проанализировано 2, пропущено 3",
 * not `analysed: 2, skipped: 3, stoppedBy: null`. Zeros, nulls and empty lists are
 * left out, and nested values are never printed.
 */

const LABELS: Record<string, string> = {
  analysed: "проанализировано",
  skipped: "пропущено",
  failed: "ошибок",
  updated: "обновлено",
  inserted: "новых",
  imported: "импортировано",
  unchanged: "без изменений",
  found: "найдено",
  pagesDone: "страниц",
  evaluated: "оценено",
  contacts: "контактов",
  linked: "связано",
  rotations: "смен прокси"
}

const STOP_LABELS: Record<string, string> = {
  unreachable: "сервер модели недоступен",
  unauthorized: "ключ модели отклонён",
  captcha: "капча",
  auth: "нужен вход",
  forbidden: "доступ запрещён",
  geo: "блокировка по региону",
  rate_limit: "лимит запросов"
}

export const runSummary = (detail: unknown): ReadonlyArray<string> => {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return []
  const d = detail as Record<string, unknown>
  const out: string[] = []

  const processed = typeof d.processed === "number" ? d.processed : null
  const target = typeof d.target === "number" ? d.target : null
  if (processed !== null && target !== null) out.push(`обработано ${processed} из ${target}`)
  else if (processed !== null && processed > 0) out.push(`обработано ${processed}`)

  for (const [key, label] of Object.entries(LABELS)) {
    const value = d[key]
    if (typeof value === "number" && value > 0) out.push(`${label} ${value}`)
  }
  if (typeof d.stoppedBy === "string" && d.stoppedBy !== "") {
    out.push(`остановлен: ${STOP_LABELS[d.stoppedBy] ?? d.stoppedBy}`)
  }
  if (d.interrupted === true) out.push("прерван")
  return out
}
