import { formatAge } from "@/shared/lib/format"

/** Секунды между моментами; отрицательные значения приводятся к нулю. */
const secondsBetween = (from: number, to: number): number => Math.max(0, Math.round((to - from) / 1000))

/** «только что», «3 мин назад», «2 ч назад»; пусто, если времени нет. */
export const agoText = (iso: string | null | undefined, now: number): string | null => {
  if (iso === null || iso === undefined) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const seconds = secondsBetween(at, now)
  return seconds < 45 ? "только что" : `${formatAge(seconds)} назад`
}

/** «через 12 мин»; «сейчас», если момент уже наступил. */
export const inText = (iso: string | null | undefined, now: number): string | null => {
  if (iso === null || iso === undefined) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const seconds = secondsBetween(now, at)
  return at <= now || seconds < 45 ? "сейчас" : `через ${formatAge(seconds)}`
}

/** Прошло ли больше `seconds` секунд с момента `iso`. */
export const olderThan = (iso: string | null | undefined, now: number, seconds: number): boolean => {
  if (iso === null || iso === undefined) return false
  const at = Date.parse(iso)
  return !Number.isNaN(at) && (now - at) / 1000 > seconds
}
