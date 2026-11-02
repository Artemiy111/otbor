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
