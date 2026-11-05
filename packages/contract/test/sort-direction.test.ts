import { describe, expect, test } from "bun:test"
import { SortDirection } from "@otbor/contract"
import { Schema } from "effect"

describe("SortDirection", () => {
  test("accepts desc and asc only", () => {
    const decode = Schema.decodeUnknownSync(SortDirection)
    expect(decode("desc")).toBe("desc")
    expect(decode("asc")).toBe("asc")
    expect(() => decode("up")).toThrow()
    expect(() => decode("")).toThrow()
    expect(() => decode(undefined)).toThrow()
  })
})
