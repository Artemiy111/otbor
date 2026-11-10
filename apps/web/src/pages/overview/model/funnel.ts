import type { Overview } from "@otbor/contract"
import { decisionReasonLabel } from "@/shared/lib/status"
import { formatNumber } from "@/shared/lib/format"
import { rate } from "./hero"

export interface FunnelStage {
  readonly id: "found" | "matched" | "created" | "sent" | "viewed" | "invited"
  readonly label: string
  readonly value: number
  /** Доля от ступени-ориентира своей группы, 0..100, для длины полосы. */
  readonly width: number
  /** Конверсия из предыдущей ступени; null, если ступень первая, делить не на что или доля больше 100 % (разные выборки). */
  readonly rateFromPrevious: number | null
  /** Приглушённая добавка: «пропущено 31 103», «отказов 92». */
  readonly aside: string | null
  /** Ступень начинает новую группу (вакансии → отклики): между группами конверсии нет. */
  readonly startsGroup: boolean
}

/**
 * Воронка делится на две группы: вакансии (найдено → подошли) и отклики
 * (созданы → отправлены → просмотрены → приглашения). Внутри группы длина
 * полосы честная, между группами числа считаются по разным выборкам, поэтому
 * там конверсии нет.
 */
export const buildFunnel = (funnel: Overview["funnel"]): ReadonlyArray<FunnelStage> => {
  const bar = (value: number, anchor: number): number =>
    anchor <= 0 || value <= 0 ? 0 : Math.max(2, Math.min(100, (value / anchor) * 100))
  const step = (
    id: FunnelStage["id"],
    label: string,
    value: number,
    anchor: number,
    previous: number | null,
    aside: string | null,
    startsGroup = false
  ): FunnelStage => {
    const raw = previous === null ? null : rate(value, previous)
    return {
      id,
      label,
      value,
      width: bar(value, anchor),
      rateFromPrevious: raw !== null && raw <= 100 ? raw : null,
      aside,
      startsGroup
    }
  }
  return [
    step("found", "Найдено вакансий", funnel.vacanciesFound, funnel.vacanciesFound, null, null, true),
    step(
      "matched",
      "Подошли под фильтр",
      funnel.decisionsApply,
      funnel.vacanciesFound,
      funnel.vacanciesFound,
      funnel.decisionsSkip > 0 ? `пропущено ${formatNumber(funnel.decisionsSkip)}` : null
    ),
    step("created", "Создано откликов", funnel.applicationsCreated, funnel.applicationsCreated, null, null, true),
    step("sent", "Отправлено", funnel.sent, funnel.applicationsCreated, funnel.applicationsCreated, null),
    step("viewed", "Просмотрено", funnel.viewed, funnel.applicationsCreated, funnel.sent, null),
    step(
      "invited",
      "Приглашения",
      funnel.invited,
      funnel.applicationsCreated,
      funnel.viewed,
      funnel.rejected > 0 ? `отказов ${formatNumber(funnel.rejected)}` : null
    )
  ]
}

export interface SkipRow {
  readonly code: string
  readonly label: string
  readonly count: number
  /** Доля от суммы показанных причин, %. */
  readonly share: number
  /** Длина полосы относительно самой частой причины, 0..100. */
  readonly width: number
}

const SKIP_LABELS: Record<string, string> = {
  role_unknown: "Роль вакансии неясна",
  role_rejected: "Роль не подходит",
  blocked_applied: "Уже откликались",
  blocked_blacklist: "Работодатель в чёрном списке",
  blocked_filter: "Не прошла фильтр откликов",
  blocked_archived: "Вакансия в архиве",
  blocked_low_fit: "Слабо подходит по навыкам",
  blocked_rejected: "Ранее отклонена",
  blocked_test: "Требует тест"
}

export const skipLabel = (code: string): string => SKIP_LABELS[code] ?? decisionReasonLabel(code)

export const buildSkipRows = (reasons: Overview["skipReasons"]): ReadonlyArray<SkipRow> => {
  const total = reasons.reduce((sum, row) => sum + row.count, 0)
  const max = Math.max(0, ...reasons.map((row) => row.count))
  return reasons.map((row) => ({
    code: row.code,
    label: skipLabel(row.code),
    count: row.count,
    share: total > 0 ? Math.round((row.count / total) * 100) : 0,
    width: max > 0 ? Math.max(2, (row.count / max) * 100) : 0
  }))
}
