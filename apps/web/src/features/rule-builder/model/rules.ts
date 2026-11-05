import type { PresetFilter, PresetRule } from "@otbor/contract"

/**
 * Old presets stored `text` (a title substring) as a shorthand
 * next to the rules. It is an ordinary rule now, so the detail
 * and the editor normalize it through this one function.
 */
export const presetRules = (filter: PresetFilter): ReadonlyArray<PresetRule> => {
  const rules: Array<PresetRule> = [...(filter.rules ?? [])]
  const text = filter.text?.trim() ?? ""
  if (text !== "") {
    rules.push({ field: "title", op: "contains", value: text })
  }
  return rules
}
