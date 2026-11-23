import { describe, expect, test } from "bun:test"
import { resolveRunnerKinds } from "../src/commands/runner.ts"

describe("resolveRunnerKinds", () => {
  test("flags override the saved registration", () => {
    expect(resolveRunnerKinds(["browser"], ["inference"])).toEqual(["browser"])
  })

  test("the saved list is used when no flag is given", () => {
    expect(resolveRunnerKinds([], ["inference"])).toEqual(["inference"])
  })

  test("an empty saved list means all kinds", () => {
    expect(resolveRunnerKinds([], [])).toEqual(["browser", "inference"])
    expect(resolveRunnerKinds([], undefined)).toEqual(["browser", "inference"])
  })
})
