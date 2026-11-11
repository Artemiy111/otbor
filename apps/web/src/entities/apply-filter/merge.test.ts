import { describe, expect, test } from "bun:test"
import type { ApplyFilterView } from "@otbor/contract"
import {
  buildAutoSavePayload,
  buildRulesSavePayload,
  isDirty,
  settingsKey,
  settingsOf,
  validateAutoSettings,
  type AutoSettingsValues
} from "./merge"

const serverFilter = { marker: "server" } as unknown as ApplyFilterView["filter"]
const formFilter = { marker: "form" } as unknown as ApplyFilterView["filter"]

const view = (patch: Partial<ApplyFilterView> = {}): ApplyFilterView => ({
  source: "exact",
  id: null,
  hhAccountId: "acc" as ApplyFilterView["hhAccountId"],
  resumeId: null,
  filter: serverFilter,
  minFit: 50,
  tests: "human",
  freshHalfLifeHours: 72,
  autoMode: "auto",
  dailyLimit: 150,
  batchSize: 10,
  sort: "fit",
  sortDirection: "desc",
  minPriority: 3,
  requireLetter: false,
  boosts: [],
  writingHarness: "claude",
  writingModel: null,
  writingEffort: null,
  templatePresetId: null,
  updatedAt: null,
  ...patch
})

const values = (patch: Partial<AutoSettingsValues> = {}): AutoSettingsValues => ({
  ...settingsOf(view()),
  ...patch
})

const target = { hhAccountId: "acc", resumeId: null }

describe("buildAutoSavePayload", () => {
  test("filter always comes from the fresh server value, never from the form", () => {
    const payload = buildAutoSavePayload(view(), target, values())
    expect(payload.filter).toBe(serverFilter)
  })

  test("own row: the rules half is not sent at all", () => {
    const payload = buildAutoSavePayload(view({ source: "exact" }), target, values())
    expect(payload.minFit).toBeUndefined()
    expect(payload.tests).toBeUndefined()
    expect(payload.freshHalfLifeHours).toBeUndefined()
  })

  test("inherited row: the new row copies the rules half of the filter that applied", () => {
    const payload = buildAutoSavePayload(view({ source: "account", minFit: 61, tests: "skip" }), target, values())
    expect(payload.minFit).toBe(61)
    expect(payload.tests).toBe("skip")
    expect(payload.freshHalfLifeHours).toBe(72)
  })

  test("writer fields are trimmed so a blank clears them", () => {
    const payload = buildAutoSavePayload(view(), target, values({ writingHarness: "  ", writingModel: " haiku " }))
    expect(payload.writingHarness).toBe("")
    expect(payload.writingModel).toBe("haiku")
  })
})

describe("buildRulesSavePayload", () => {
  const rules = { filter: formFilter, minFit: 40, tests: "allow" as const, freshHalfLifeHours: 24 }

  test("own row: auto settings are omitted so the server keeps them", () => {
    const payload = buildRulesSavePayload(view({ source: "exact" }), target, rules)
    expect(payload.filter).toBe(formFilter)
    expect(payload.autoMode).toBeUndefined()
    expect(payload.dailyLimit).toBeUndefined()
    expect(payload.boosts).toBeUndefined()
  })

  test("inherited row: the new row keeps the mode that applied, not the default off", () => {
    const payload = buildRulesSavePayload(view({ source: "account", autoMode: "auto", dailyLimit: 99 }), target, rules)
    expect(payload.autoMode).toBe("auto")
    expect(payload.dailyLimit).toBe(99)
    expect(payload.minFit).toBe(40)
  })

  test("built-in default: nothing stored, so the defaults are materialised", () => {
    const payload = buildRulesSavePayload(view({ source: "default", autoMode: "off" }), target, rules)
    expect(payload.autoMode).toBe("off")
  })
})

describe("validateAutoSettings", () => {
  test("accepts the loaded values", () => {
    expect(validateAutoSettings(values(), false)).toBeNull()
  })
  test("rejects a bad batch size, limit, priority and weight", () => {
    expect(validateAutoSettings(values({ batchSize: 0 }), false)).toContain("партии")
    expect(validateAutoSettings(values({ dailyLimit: -1 }), false)).toContain("лимит")
    expect(validateAutoSettings(values({ minPriority: -2 }), false)).toContain("приоритет")
    const boost = { rule: { field: "title" }, weight: 80 } as unknown as AutoSettingsValues["boosts"][number]
    expect(validateAutoSettings(values({ boosts: [boost] }), false)).toContain("Вес")
  })
  test("incomplete boosts are an error", () => {
    expect(validateAutoSettings(values(), true)).toContain("бонус")
  })
})

describe("dirty detection", () => {
  test("same values give the same key and are clean", () => {
    const key = settingsKey(values())
    expect(isDirty(key, settingsKey(values()), false)).toBe(false)
  })
  test("a changed field or an incomplete boost is dirty", () => {
    const key = settingsKey(values())
    expect(isDirty(key, settingsKey(values({ batchSize: 11 })), false)).toBe(true)
    expect(isDirty(key, key, true)).toBe(true)
  })
  test("blank spaces in the writer do not count as an edit", () => {
    const key = settingsKey(values({ writingModel: "" }))
    expect(isDirty(key, settingsKey(values({ writingModel: "  " })), false)).toBe(false)
  })
  test("nothing loaded yet is never dirty", () => {
    expect(isDirty(null, settingsKey(values()), false)).toBe(false)
  })
})
