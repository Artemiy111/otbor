/**
 * Salary stated in the vacancy description ("Оклад 250000р до вычета налога",
 * "Зарплата до 150 000 ₽ на руки", "зарплата от 2 000 $").
 *
 * Used when hh has no structured compensation or to cross-check it. Pure and
 * conservative: an amount counts only when a pay word sits in the same
 * sentence, perks (taxi, meals, referral bonus) and per-hour/per-task rates
 * are ignored, and a bare number needs a tax marker or "оклад" next to it.
 */
import type { SalaryInText } from "@otbor/contract"
import { collapseWhitespace } from "./text.ts"

/** Words that say "this number is pay". */
const PAY_RE =
  /(?:оклад\p{L}*|зарплат\p{L}*|заработн\p{L}*\s+плат\p{L}*|з\/п|зп(?!\p{L})|фикс\p{L}*|вилк\p{L}*|оплат\p{L}*|доход\p{L}*|вознагражден\p{L}*|ставк\p{L}*|salary|compensation|gross|(?<![\w.])net\b|на\s+руки|до\s+вычета|после\s+вычета|до\s+налог\p{L}*|после\s+налог\p{L}*|на\s+карт\p{L}*)/iu

/** Perks, bonuses and company facts that carry money but are not the pay. */
const NOT_PAY_RE =
  /(?:компенс\p{L}*|бонус\p{L}*|премирован\p{L}*|рефер\p{L}*|приведи|друг\p{L}*|такси|питани\p{L}*|обед\p{L}*|депозит\p{L}*|кафетери\p{L}*|абонемент\p{L}*|инвестиц\p{L}*|оборот\p{L}*|выручк\p{L}*|бюджет\p{L}*|сделк\p{L}*|штраф\p{L}*|пересмотр\p{L}*|подъ[её]мн\p{L}*|релокац\p{L}*|за\s+рекоменд\p{L}*|\d\s*%)/iu

/** Per-unit rates: not a monthly salary. */
const PER_UNIT_RE =
  /(?:в\s+час|за\s+час|\/\s*час|в\s+день|за\s+день|за\s+смену|за\s+урок|за\s+проект|за\s+заказ|за\s+задач\p{L}*|за\s+курс|за\s+дисциплин\p{L}*|за\s+один|за\s+каждый|за\s+1\s|per\s+hour|hourly|\/\s*h\b)/iu

const GROSS_RE = /(?:до\s+вычета|до\s+налог\p{L}*|до\s+ндфл|gross|гросс|брутто|before\s+tax)/iu
const NET_RE = /(?:на\s+руки|после\s+вычета|после\s+налог\p{L}*|после\s+ндфл|(?<![\w.])net\b|нетто|after\s+tax|чистыми|на\s+карт\p{L}*)/iu

const NUMBER = String.raw`\d{1,3}(?:[\s  ]\d{3})+|\d+(?:[.,]\d+)?`
const SUFFIX = String.raw`(?:\s*(?:тысяч\p{L}*|тыс\.?|т\.\s?р\.?|тр(?!\p{L})|к(?!\p{L})|k\b))?`
const CURRENCY = String.raw`(?:\s*(?:₽|руб\p{L}*\.?|р(?!\p{L})\.?|rub|rur|\$|usd|долл\p{L}*|€|eur|евро))?`
const AMOUNT = String.raw`(?<n>${NUMBER})${SUFFIX}${CURRENCY}`
const AMOUNT_RE = new RegExp(AMOUNT, "giu")
const RANGE_RE = new RegExp(
  String.raw`(?:от\s+)?(?<a>${NUMBER})(?<as>${SUFFIX})(?<ac>${CURRENCY})\s*(?:до|[-–—]|\.\.)\s*(?<b>${NUMBER})(?<bs>${SUFFIX})(?<bc>${CURRENCY})`,
  "iu"
)

type Currency = SalaryInText["currency"]

const currencyOf = (s: string): Currency | null => {
  if (/[$]|usd|долл/iu.test(s)) return "USD"
  if (/€|eur|евро/iu.test(s)) return "EUR"
  if (/₽|руб|(?<!\p{L})р(?!\p{L})|rub|rur/iu.test(s)) return "RUB"
  return null
}

const toNumber = (digits: string, suffix: string): number => {
  const base = Number(digits.replace(/[\s  ]/g, "").replace(",", "."))
  return /тыс|т\.\s?р|тр|к|k/iu.test(suffix.trim()) ? Math.round(base * 1000) : base
}

const plausible = (amount: number, currency: Currency): boolean =>
  currency === "RUB" ? amount >= 15_000 && amount <= 5_000_000 : amount >= 500 && amount <= 50_000

const sentencesOf = (text: string): Array<string> =>
  text
    .split(/(?<=[.!?…;])\s+(?=[А-ЯЁA-Z•·—–-])|\n+|[•·]/u)
    .map(collapseWhitespace)
    .filter(Boolean)

const fromSentence = (sentence: string): SalaryInText | null => {
  if (!PAY_RE.test(sentence) || NOT_PAY_RE.test(sentence) || PER_UNIT_RE.test(sentence)) return null
  const gross = GROSS_RE.test(sentence) ? true : NET_RE.test(sentence) ? false : null
  // A bare number (no currency, no thousands marker) is pay only next to a tax marker or "оклад".
  const bareOk = gross !== null || /оклад|зарплат|з\/п|вилк/iu.test(sentence)

  const range = RANGE_RE.exec(sentence)
  if (range?.groups) {
    const g = range.groups as Record<string, string | undefined>
    const [a, as, ac, b, bs, bc] = [g.a ?? "", g.as ?? "", g.ac ?? "", g.b ?? "", g.bs ?? "", g.bc ?? ""]
    const currency = currencyOf(`${ac} ${bc}`) ?? currencyOf(sentence) ?? "RUB"
    const sfx = as.trim() !== "" ? as : bs
    const from = toNumber(a, sfx)
    const to = toNumber(b, bs)
    if (from <= to && plausible(from, currency) && plausible(to, currency)) {
      return { from, to, currency, gross, evidence: sentence.slice(0, 280) }
    }
  }

  for (const m of sentence.matchAll(AMOUNT_RE)) {
    const full = m[0]
    const digits = m.groups?.n ?? ""
    const hasUnit = /тыс|т\.\s?р|тр|к(?!\p{L})|k\b|₽|руб|(?<!\p{L})р(?!\p{L})|\$|usd|€|eur|евро|долл|rub|rur/iu.test(full)
    if (!hasUnit && !bareOk) continue
    // "69 тыс. сотрудников": a headcount, not money.
    if (/^[\s.,]*(?:сотрудн|человек|пользовател|клиент|специалист|инженер|партн)/iu.test(sentence.slice((m.index ?? 0) + full.length))) continue
    const currency = currencyOf(full) ?? currencyOf(sentence) ?? "RUB"
    const suffix = full.slice(digits.length)
    const amount = toNumber(digits, suffix)
    if (!plausible(amount, currency)) continue
    const before = sentence.slice(0, m.index ?? 0).toLowerCase()
    const isTo = /(?:^|\s)до\s*$/u.test(before) || /(?:^|\s)up\s+to\s*$/u.test(before)
    const isFrom = /(?:^|\s)от\s*$/u.test(before) || /(?:^|\s)from\s*$/u.test(before)
    return {
      from: isTo ? null : amount,
      to: isFrom ? null : amount,
      currency,
      gross,
      evidence: sentence.slice(0, 280)
    }
  }
  return null
}

/** The first monthly salary stated in the text, or `null`. */
export const detectSalaryInText = (text: string | null | undefined): SalaryInText | null => {
  if (!text) return null
  for (const sentence of sentencesOf(text)) {
    const found = fromSentence(sentence)
    if (found !== null) return found
  }
  return null
}
