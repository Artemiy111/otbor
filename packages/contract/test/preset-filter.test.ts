import { describe, expect, test } from "bun:test"
import { type KeywordId, parseBoosts, parsePresetFilter, PresetFilter } from "@otbor/contract"
import { Schema } from "effect"

const firstKeyword = "0190f0aa-0000-7000-8000-000000000001" as KeywordId
const secondKeyword = "0190f0aa-0000-7000-8000-000000000002" as KeywordId

describe("preset filter parsing", () => {
  test("an absent or legacy filter means no constraints", () => {
    expect(parsePresetFilter(undefined)).toEqual({})
    expect(parsePresetFilter(null)).toEqual({})
    expect(parsePresetFilter({ all: [] })).toEqual({})
  })

  test("blank values are dropped and text is trimmed", () => {
    expect(
      parsePresetFilter({
        text: "  DevOps  ",
        keywordIds: [firstKeyword, firstKeyword, secondKeyword]
      })
    ).toEqual({
      text: "DevOps",
      keywordIds: [firstKeyword, secondKeyword]
    })
    expect(parsePresetFilter({ text: "   ", keywordIds: [] })).toEqual({})
    expect(parsePresetFilter({ includeArchived: true })).toEqual({})
    expect(parsePresetFilter({ location: "any" })).toEqual({})
    expect(parsePresetFilter({ location: "text_or_skills" })).toEqual({
      location: "text_or_skills"
    })
    expect(parsePresetFilter({ includeBlacklisted: true })).toEqual({})
  })

  test("a legacy gate key and gate / role_family rules are silently dropped", () => {
    expect(parsePresetFilter({ gate: "match" })).toEqual({})
    expect(parsePresetFilter({ gate: "maybe" })).toEqual({})
    const salary = { field: "salary", op: "gte", value: "250000" } as const
    expect(
      parsePresetFilter({
        text: "DevOps",
        gate: "reject",
        rules: [
          { field: "gate", op: "eq", value: "match" },
          salary,
          { field: "role_family", op: "in", value: ["devops"] }
        ],
        groups: [
          {
            branches: [
              { rules: [{ field: "gate", op: "eq", value: "match" }] },
              { rules: [{ field: "role_family", op: "eq", value: "sre" }, salary] }
            ]
          },
          { branches: [{ rules: [{ field: "gate", op: "neq", value: "reject" }] }] }
        ]
      })
    ).toEqual({
      text: "DevOps",
      rules: [salary],
      groups: [{ branches: [{ rules: [salary] }] }]
    })
  })

  test("the schema round-trips a concrete filter", () => {
    const filter = {
      text: "DevOps",
      keywordIds: [firstKeyword],
      location: "skills" as const
    }
    expect(Schema.decodeUnknownSync(PresetFilter)(filter)).toEqual(filter)
  })
})

test("parsePresetFilter drops empty group rules and empty branches", () => {
  const filter = parsePresetFilter({
    groups: [
      { branches: [{ rules: [{ field: "salary", op: "gte", value: "" }] }, { rules: [] }] },
      {
        branches: [
          { rules: [{ field: "salary", op: "gte", value: 3000, currency: "USD" }, { field: "title", op: "contains", value: " " }] }
        ]
      }
    ]
  })
  expect(filter.groups).toEqual([
    { branches: [{ rules: [{ field: "salary", op: "gte", value: 3000, currency: "USD" }, { field: "title", op: "contains", value: " " }] }] }
  ])
})

test("a location rule keeps its area ids and an empty one is dropped", () => {
  const rule = { field: "location", op: "in", value: ["113", "160"] } as const
  expect(parsePresetFilter({ rules: [rule] })).toEqual({ rules: [rule] })
  expect(parsePresetFilter({ rules: [{ field: "location", op: "in", value: [] }] })).toEqual({})
})

describe("apply boosts parsing", () => {
  test("incomplete boost rules are dropped, complete ones kept", () => {
    expect(parseBoosts(undefined)).toEqual([])
    expect(
      parseBoosts([
        { rule: { field: "salary", op: "gte", value: 250000, currency: "RUB" }, weight: 8 },
        { rule: { field: "work_format", op: "in", value: [] }, weight: 5 },
        { rule: { field: "title", op: "contains", value: "" }, weight: 5 },
        { rule: { field: "archived", op: "is_false" }, weight: -3 }
      ])
    ).toEqual([
      { rule: { field: "salary", op: "gte", value: 250000, currency: "RUB" }, weight: 8 },
      { rule: { field: "archived", op: "is_false" }, weight: -3 }
    ])
  })

  test("a malformed boost fails to decode (non-integer weight)", () => {
    expect(() =>
      parseBoosts([{ rule: { field: "salary", op: "gte", value: 1 }, weight: 1.5 }])
    ).toThrow()
  })
})
