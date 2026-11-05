import { describe, expect, test } from "bun:test"
import { type KeywordId, parsePresetFilter, PresetFilter } from "@otbor/contract"
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
        gate: "match",
        keywordIds: [firstKeyword, firstKeyword, secondKeyword],
        includeArchived: false
      })
    ).toEqual({
      text: "DevOps",
      gate: "match",
      keywordIds: [firstKeyword, secondKeyword]
    })
    expect(parsePresetFilter({ text: "   ", keywordIds: [] })).toEqual({})
    expect(parsePresetFilter({ includeArchived: true })).toEqual({ includeArchived: true })
    expect(parsePresetFilter({ location: "any" })).toEqual({})
    expect(parsePresetFilter({ location: "text_or_skills" })).toEqual({
      location: "text_or_skills"
    })
    expect(parsePresetFilter({ includeBlacklisted: true })).toEqual({
      includeBlacklisted: true
    })
    expect(parsePresetFilter({ includeBlacklisted: false })).toEqual({})
  })

  test("an unknown gate is rejected instead of silently ignored", () => {
    expect(() => parsePresetFilter({ gate: "maybe" })).toThrow()
  })

  test("the schema round-trips a concrete filter", () => {
    const filter = {
      text: "DevOps",
      gate: "reject" as const,
      keywordIds: [firstKeyword],
      location: "skills" as const,
      includeArchived: true
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
