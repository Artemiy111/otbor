import type {
  KeywordMatchLocation,
  PresetField,
  PresetFilter,
  PresetOperator,
  PresetRule
} from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { isMultiValueOperator, presetFieldMeta } from "./fields"
import { presetRules } from "./rules"

/**
 * One rule as the builder edits it. A rule has either a scalar `text` (text,
 * number, one select value) or a list `values` (several select values or
 * lexicon terms); `usesList` says which one is live for the current operator.
 */
export interface EditableRule {
  /** Stable row key: index keys would reuse input state after a removal. */
  readonly id: number
  field: PresetField
  op: PresetOperator
  text: string
  values: Array<string>
}

export interface EditableFilter {
  rules: Array<EditableRule>
  includeArchived: boolean
  includeBlacklisted: boolean
  location: KeywordMatchLocation
  /** Legacy lexicon restriction. Carried through unchanged, never edited. */
  keywordIds: PresetFilter["keywordIds"]
}

let sequence = 0

export const newRule = (field: PresetField = "title"): EditableRule => {
  const meta = presetFieldMeta(field)
  return { id: sequence++, field, op: meta.ops[0] ?? "eq", text: "", values: [] }
}

/** Fields whose multi-value operators edit a list instead of comma-separated text. */
export const usesList = (field: PresetField): boolean =>
  field === "keywords" || presetFieldMeta(field).kind === "select"

export const toEditableRule = (rule: PresetRule): EditableRule => {
  const base: EditableRule = { ...newRule(rule.field), op: rule.op }
  const meta = presetFieldMeta(rule.field)
  if (meta.kind === "boolean") return base
  if (Array.isArray(rule.value)) {
    return isMultiValueOperator(rule.op) && usesList(rule.field)
      ? { ...base, values: rule.value.map(String) }
      : { ...base, text: rule.value.join(", ") }
  }
  return { ...base, text: rule.value === undefined ? "" : String(rule.value) }
}

export const emptyEditable = (): EditableFilter => ({
  rules: [],
  includeArchived: false,
  includeBlacklisted: false,
  location: "any",
  keywordIds: undefined
})

export const toEditable = (filter: PresetFilter | undefined): EditableFilter =>
  filter === undefined
    ? emptyEditable()
    : {
        rules: presetRules(filter).map(toEditableRule),
        includeArchived: filter.includeArchived === true,
        includeBlacklisted: filter.includeBlacklisted === true,
        location: filter.location ?? "any",
        keywordIds: filter.keywordIds
      }

/** The stored rule for an editable one, or null while its value is still empty. */
export const buildRule = (rule: EditableRule): PresetRule | null => {
  const meta = presetFieldMeta(rule.field)
  if (meta.kind === "boolean") return { field: rule.field, op: rule.op }
  if (meta.kind === "number") {
    const text = rule.text.trim()
    const value = Number(text)
    if (text === "" || !Number.isFinite(value)) return null
    return { field: rule.field, op: rule.op, value }
  }
  if (isMultiValueOperator(rule.op)) {
    const terms = usesList(rule.field) ? rule.values : rule.text.split(",")
    const values = [...new Set(terms.map((value) => value.trim()).filter((value) => value !== ""))]
    return values.length === 0 ? null : { field: rule.field, op: rule.op, value: values }
  }
  const value = rule.text.trim()
  return value === "" ? null : { field: rule.field, op: rule.op, value }
}

export const isComplete = (rule: EditableRule): boolean => buildRule(rule) !== null

/** Switches a rule's operator, moving the value between the scalar and list controls. */
export const changeOperator = (rule: EditableRule, op: PresetOperator): void => {
  if (usesList(rule.field)) {
    if (isMultiValueOperator(op) && !isMultiValueOperator(rule.op)) {
      const single = rule.text.trim()
      rule.values = single === "" ? [] : [single]
      rule.text = ""
    } else if (!isMultiValueOperator(op) && isMultiValueOperator(rule.op)) {
      rule.text = rule.values[0] ?? ""
      rule.values = []
    }
  }
  rule.op = op
}

export const changeField = (rule: EditableRule, field: PresetField): void => {
  rule.field = field
  rule.op = presetFieldMeta(field).ops[0] ?? "eq"
  rule.text = ""
  rule.values = []
}

/** Only complete rules reach the filter, so a half-typed row never empties a list. */
export const buildFilter = (state: EditableFilter): PresetFilter =>
  parsePresetFilter({
    rules: state.rules.map(buildRule).filter((rule): rule is PresetRule => rule !== null),
    ...(state.includeArchived ? { includeArchived: true } : {}),
    ...(state.includeBlacklisted ? { includeBlacklisted: true } : {}),
    ...(state.location === "any" ? {} : { location: state.location }),
    ...(state.keywordIds === undefined ? {} : { keywordIds: state.keywordIds })
  })
