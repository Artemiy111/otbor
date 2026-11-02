const numberFormat = new Intl.NumberFormat("ru-RU")

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short"
})

export const formatNumber = (value: number): string => numberFormat.format(value)

export const formatDate = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

export const formatSalary = (
  from: number | null | undefined,
  to: number | null | undefined,
  currency: string | null | undefined
): string => {
  const suffix = currency === null || currency === undefined || currency === "" ? "" : ` ${currency}`
  if (from !== null && from !== undefined && to !== null && to !== undefined) {
    return `${formatNumber(from)} – ${formatNumber(to)}${suffix}`
  }
  if (from !== null && from !== undefined) return `от ${formatNumber(from)}${suffix}`
  if (to !== null && to !== undefined) return `до ${formatNumber(to)}${suffix}`
  return "—"
}

export const formatPriority = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : "—"

export const formatRating = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(1)

export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value}%`

export const formatAge = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 с"
  if (seconds < 60) return `${Math.round(seconds)} с`
  if (seconds < 3600) return `${Math.round(seconds / 60)} мин`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} ч`
  return `${Math.round(seconds / 86_400)} д`
}

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  if (seconds < 60) return `${Math.round(seconds)} с`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return `${minutes} мин ${Math.round(seconds % 60)} с`
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600)
    return `${hours} ч ${Math.round((seconds % 3600) / 60)} мин`
  }
  const days = Math.floor(seconds / 86_400)
  return `${days} д ${Math.round((seconds % 86_400) / 3600)} ч`
}

export const payloadPreview = (payload: unknown): string => {
  if (payload === null || payload === undefined) return "—"
  const text = typeof payload === "string" ? payload : JSON.stringify(payload)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

export const payloadText = (payload: unknown): string => {
  if (payload === null || payload === undefined) return "—"
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
}
