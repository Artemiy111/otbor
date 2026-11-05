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

  test("identity is one OR group: the title list or the analysis role", () => {
    const groups = DEFAULT_APPLY_FILTER.filter.groups ?? []
    const identity = groups.find((group) =>
      group.branches.some((branch) => branch.rules.some((rule) => rule.field === "analysis_role"))
    )
    expect(identity?.branches.length).toBe(2)
    const titleRule = identity?.branches[0]?.rules[0]
    expect(titleRule).toMatchObject({ field: "title", op: "contains_any" })
    expect(titleRule?.value).toEqual([...DEVOPS_TITLE_STEMS])
  })

  test("rejects are one title not_contains_any rule with the whole list", () => {
    const rejects = (DEFAULT_APPLY_FILTER.filter.rules ?? []).filter((rule) => rule.op === "not_contains_any")
    expect(rejects.length).toBe(1)
    expect(rejects[0]).toMatchObject({ field: "title" })
    expect((rejects[0]!.value as ReadonlyArray<string>).length).toBeGreaterThan(10)
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

describe("list operators keep the template short", () => {
  test("the DevOps template is a handful of rules, not one per stem", () => {
    const filter = DEFAULT_APPLY_FILTER.filter
    expect(filter.rules?.length).toBe(2)
    expect(filter.groups?.length).toBe(1)
    expect(filter.groups![0]!.branches.length).toBe(2)
    expect(describeRule({ field: "title", op: "contains_any", value: ["a", "b"] })).toBe(
      "title contains_any a,b"
    )
  })
})
