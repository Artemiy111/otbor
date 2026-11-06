const numberFormat = new Intl.NumberFormat("ru-RU")

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })
const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" })

/** "5 окт. 14:33"; with the year ("5 окт. 2025, 14:33") when it is not the current one. */
const humanDate = (date: Date): string => {
  const day = dayFormat.format(date)
  const time = timeFormat.format(date)
  return date.getFullYear() === new Date().getFullYear()
    ? `${day} ${time}`
    : `${day} ${date.getFullYear()}, ${time}`
}

export const formatNumber = (value: number): string => numberFormat.format(value)

export const formatDate = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : humanDate(date)
}

const CURRENCY_SYMBOLS: Record<string, string> = { RUB: "₽", RUR: "₽", USD: "$", EUR: "€", KZT: "₸", BYN: "Br" }

/** `RUR`/`RUB` → `₽`, `USD` → `$`, `EUR` → `€`; unknown codes stay as they are. */
export const currencySymbol = (code: string): string => CURRENCY_SYMBOLS[code.toUpperCase()] ?? code

export const formatSalary = (
  from: number | null | undefined,
  to: number | null | undefined,
  currency: string | null | undefined
): string => {
  const suffix = currency === null || currency === undefined || currency === "" ? "" : ` ${currencySymbol(currency)}`
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

/** A duration in hours as "5ч" under a day, "7д 4ч" from a day on. */
export const formatAgeHours = (hours: number): string => {
  const total = Math.max(0, Math.round(hours))
  if (total < 24) return `${total}ч`
  const days = Math.floor(total / 24)
  const rest = total % 24
  return rest === 0 ? `${days}д` : `${days}д ${rest}ч`
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
