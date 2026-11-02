import type { PresetFilter } from "@otbor/contract"

export const presetKeys = {
  all: ["presets"] as const,
  list: (kind: string) => ["presets", "list", kind] as const,
  /** The filter itself is the key: a new rule set is a different preview. */
  preview: (filter: PresetFilter) =>
    ["presets", "preview", JSON.stringify(filter)] as const
}
