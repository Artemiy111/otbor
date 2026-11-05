import { describe, expect, test } from "bun:test"
import { currentVersions, isDecisionStale, type DecisionFingerprint } from "../src/index.ts"

const current = {
  contentHash: "h2",
  policyVersion: currentVersions.policyVersion
}

const fresh: DecisionFingerprint = {
  vacancyContentHash: "h2",
  policyVersion: currentVersions.policyVersion
}

describe("decision staleness", () => {
  test("no decision is stale", () => {
    expect(isDecisionStale(null, current)).toBe(true)
  })

  test("a decision for the same content, and policy is current", () => {
    expect(isDecisionStale(fresh, current)).toBe(false)
  })

  test("changed vacancy content makes the decision stale", () => {
    expect(isDecisionStale({ ...fresh, vacancyContentHash: "h1" }, current)).toBe(true)
  })

  test("a decision that predates the content hash is stale once", () => {
    expect(isDecisionStale({ ...fresh, vacancyContentHash: null }, current)).toBe(true)
  })

  test("another policy version is stale in both directions", () => {
    expect(isDecisionStale({ ...fresh, policyVersion: currentVersions.policyVersion - 1 }, current)).toBe(true)
    expect(isDecisionStale({ ...fresh, policyVersion: currentVersions.policyVersion + 1 }, current)).toBe(true)
  })
})
