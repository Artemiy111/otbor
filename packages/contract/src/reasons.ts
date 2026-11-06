/** A duration in hours as "5ч" under a day, "7д 4ч" from a day on. */
export const formatAgeHours = (hours: number): string => {
  const total = Math.max(0, Math.round(hours))
  if (total < 24) return `${total}ч`
  const days = Math.floor(total / 24)
  const rest = total % 24
  return rest === 0 ? `${days}д` : `${days}д ${rest}ч`
}

/**
 * A decision reason's detail for people. A freshness detail is the publication
 * instant (ISO 8601), shown as the age at the moment of the decision.
 */
export const decisionReasonDetail = (
  reason: { readonly code: string; readonly detail?: string | undefined },
  decidedAt: string
): string | null => {
  if (reason.detail === undefined || reason.detail === "") return null
  if (reason.code !== "freshness") return reason.detail
  const hours = (Date.parse(decidedAt) - Date.parse(reason.detail)) / 3_600_000
  return Number.isFinite(hours) ? formatAgeHours(hours) : reason.detail
}
