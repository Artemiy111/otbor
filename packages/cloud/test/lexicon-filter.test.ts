import { describe, expect, test } from "bun:test"
import { likePattern } from "../src/repositories/LexiconRepository.ts"

describe("preset text matching", () => {
  test("the pattern is a literal, case-insensitive substring", () => {
    expect(likePattern("DevOps")).toBe("%DevOps%")
    expect(likePattern("  platform  ")).toBe("%platform%")
  })

  test("LIKE wildcards in user text are escaped", () => {
    expect(likePattern("100%")).toBe("%100\\%%")
    expect(likePattern("snake_case")).toBe("%snake\\_case%")
    expect(likePattern("back\\slash")).toBe("%back\\\\slash%")
  })
})
