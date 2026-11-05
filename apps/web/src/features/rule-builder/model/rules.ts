import type { PresetFilter, PresetRule } from "@otbor/contract"

/**
 * Old presets stored `text` (a title substring) and `gate` (a cached verdict)
 * as shorthands next to the rules. Both are ordinary rules now, so the detail
 * and the editor normalize them through this one function.
 */
export const presetRules = (filter: PresetFilter): ReadonlyArray<PresetRule> => {
  const rules: Array<PresetRule> = [...(filter.rules ?? [])]
  const text = filter.text?.trim() ?? ""
  if (text !== "") {
    rules.push({ field: "title", op: "contains", value: text })
  }
  if (filter.gate !== undefined) {
    rules.push({ field: "gate", op: "eq", value: filter.gate })
  }
  return rules
}
