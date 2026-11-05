import type { MarketAnalytics, PresetId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface MarketInput {
  /** Narrow the selection with this preset's filter. */
  readonly presetId?: string
  /** Only vacancies published in the last N days. */
  readonly sinceDays?: number
  /** ISO code, default RUB. */
  readonly currency?: string
}

export const marketApi = {
  get: (input: MarketInput): Promise<MarketAnalytics> =>
    call((client) =>
      client.MarketAnalyticsGet({
        presetId: input.presetId as PresetId | undefined,
        sinceDays: input.sinceDays,
        currency: input.currency
      })
    )
}
