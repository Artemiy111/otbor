import { describe, expect, test } from "bun:test"
import { parsePresetFilter } from "@otbor/contract"
import {
  DEFAULT_APPLY_FILTER,
  DEVOPS_TITLE_STEMS,
  describeGroup,
  describeRule
} from "../src/applyFilter.ts"

describe("apply filter template", () => {
  test("is a valid, complete preset filter", () => {
    expect(parsePresetFilter(DEFAULT_APPLY_FILTER.filter)).toEqual(DEFAULT_APPLY_FILTER.filter)
    expect(DEFAULT_APPLY_FILTER).toMatchObject({ minFit: 45, tests: "human", freshHalfLifeHours: 72 })
  })

  test("the title gate is one OR group with a branch per stem plus the analysis role", () => {
    const groups = DEFAULT_APPLY_FILTER.filter.groups ?? []
    const identity = groups.find((group) =>
      group.branches.some((branch) => branch.rules.some((rule) => rule.field === "analysis_role"))
    )
    expect(identity?.branches.length).toBe(DEVOPS_TITLE_STEMS.length + 1)
  })

  test("rejects are title not_contains rules", () => {
    const rejects = (DEFAULT_APPLY_FILTER.filter.rules ?? []).filter((rule) => rule.op === "not_contains")
    expect(rejects.length).toBeGreaterThan(10)
    expect(rejects.every((rule) => rule.field === "title")).toBe(true)
  })
})

describe("rule labels", () => {
  test("read like the rule", () => {
    expect(describeRule({ field: "salary", op: "gte", value: 250000 })).toBe("salary >= 250000")
    expect(describeRule({ field: "work_format", op: "in", value: ["remote", "hybrid"] })).toBe(
      "work_format in remote,hybrid"
    )
    expect(describeRule({ field: "salary", op: "gte", value: 1, orMissing: true, currency: "RUR" })).toBe(
      "salary >= 1 (RUR, or missing)"
    )
    expect(describeRule({ field: "archived", op: "is_false" })).toBe("archived is false")
  })

  test("a group label lists branches and stays short", () => {
    const label = describeGroup({
      branches: [
        { rules: [{ field: "title", op: "contains", value: "devops" }] },
        { rules: [{ field: "title", op: "contains", value: "sre" }, { field: "salary", op: "gt", value: 1 }] }
      ]
    })
    expect(label).toBe("any of: title contains devops | title contains sre & salary > 1")
    const long = describeGroup(DEFAULT_APPLY_FILTER.filter.groups![0]!)
    expect(long.length).toBeLessThanOrEqual(160)
  })
})

describe("devops title stems", () => {
  test("cover devsecops and mlops spellings", () => {
    for (const stem of ["devsecops", "dev-sec-ops", "mlops", "ml ops", "девсекопс", "млопс"]) {
      expect(DEVOPS_TITLE_STEMS).toContain(stem)
    }
  })
})
