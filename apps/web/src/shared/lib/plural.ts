import { formatNumber } from "./format"

/** Три формы русского существительного: «1 отклик», «2 отклика», «5 откликов». */
export type PluralForms = readonly [one: string, few: string, many: string]

/** Номер формы по правилам русского языка (11-14 всегда «много»). */
export const pluralIndex = (value: number): 0 | 1 | 2 => {
  const abs = Math.abs(Math.trunc(value))
  const lastTwo = abs % 100
  const last = abs % 10
  if (lastTwo > 10 && lastTwo < 20) return 2
  if (last === 1) return 0
  if (last >= 2 && last <= 4) return 1
  return 2
}

/** Только слово: `plural(3, ["отклик", "отклика", "откликов"])` → «отклика». */
export const plural = (value: number, forms: PluralForms): string => forms[pluralIndex(value)]

/** Число с разделителями и слово: «1 204 отклика». */
export const countWord = (value: number, forms: PluralForms): string =>
  `${formatNumber(value)} ${plural(value, forms)}`
