export const marketKeys = {
  all: ["market"] as const,
  /** `presetId` is "all" when the selection is the whole corpus. */
  get: (presetId: string, sinceDays: number) => ["market", presetId, sinceDays] as const
}
