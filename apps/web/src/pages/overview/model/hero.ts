import type { Overview } from "@otbor/contract"
import { formatNumber } from "@/shared/lib/format"

export interface HeroDelta {
  readonly text: string
  readonly direction: "up" | "down" | "flat"
}

export interface HeroNumber {
  readonly id: "today" | "window" | "invited" | "found"
  readonly label: string
  readonly value: string
  readonly hint: string | null
  readonly delta: HeroDelta | null
  readonly href: string | null
}

/** Изменение к прошлому окну: проценты, если есть с чем сравнить, иначе разница. */
export const deltaOf = (current: number, previous: number): HeroDelta | null => {
  if (current === previous) return previous === 0 ? null : { text: "без изменений", direction: "flat" }
  const direction = current > previous ? "up" : "down"
  if (previous <= 0) return { text: `+${formatNumber(current)}`, direction }
  const percent = Math.round(((current - previous) / previous) * 100)
  return { text: `${percent > 0 ? "+" : "−"}${formatNumber(Math.abs(percent))} %`, direction }
}

/** Доля в процентах, одна цифра после запятой только для малых значений; null, если делить не на что. */
export const rate = (part: number, whole: number): number | null => {
  if (whole <= 0) return null
  const value = (part / whole) * 100
  return value > 0 && value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
}

export const formatRate = (value: number | null): string =>
  value === null ? "—" : `${value.toLocaleString("ru-RU")} %`

const windowWord = (days: number): string => `за ${days} ${days === 1 ? "сутки" : "дней"}`

/** Четыре главных числа окна. */
export const buildHeroNumbers = (overview: Overview): ReadonlyArray<HeroNumber> => {
  const { applications, funnel, accounts, days } = overview
  const limit = accounts.reduce((sum, account) => sum + account.usage.limit, 0)
  const conversion = rate(funnel.invited, funnel.sent)
  const windowDelta = deltaOf(applications.sentInWindow, applications.sentPrevWindow)
  return [
    {
      id: "today",
      label: "Отправлено за сутки",
      value: formatNumber(applications.sentToday),
      hint: limit > 0 ? `из ${formatNumber(limit)} по лимиту` : null,
      delta: null,
      href: "/auto-apply"
    },
    {
      id: "window",
      label: `Отправлено ${windowWord(days)}`,
      value: formatNumber(applications.sentInWindow),
      hint: windowDelta === null ? null : "к прошлому периоду",
      delta: windowDelta,
      href: "/applications"
    },
    {
      id: "invited",
      label: "Приглашения",
      value: formatNumber(funnel.invited),
      hint: conversion === null ? null : `${formatRate(conversion)} от отправленных`,
      delta: null,
      href: "/applications"
    },
    {
      id: "found",
      label: "Новых вакансий",
      value: formatNumber(funnel.vacanciesFound),
      hint: windowWord(days),
      delta: null,
      href: "/vacancies"
    }
  ]
}
