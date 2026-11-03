import { describe, expect, test } from "bun:test"
import { currentVersions, isDecisionStale, type DecisionFingerprint } from "../src/index.ts"

const current = {
  contentHash: "h2",
  policyVersion: currentVersions.policyVersion,
  rulesVersion: currentVersions.rulesVersion
}

const fresh: DecisionFingerprint = {
  vacancyContentHash: "h2",
  policyVersion: currentVersions.policyVersion,
  rulesVersion: currentVersions.rulesVersion
}

describe("decision staleness", () => {
  test("no decision is stale", () => {
    expect(isDecisionStale(null, current)).toBe(true)
  })

  test("a decision for the same content, policy and rules is current", () => {
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

  test("older gate rules are stale, but a user verdict (rules version 0) never is", () => {
    const bumped = { ...current, rulesVersion: currentVersions.rulesVersion + 1 }
    expect(isDecisionStale(fresh, bumped)).toBe(true)
    expect(isDecisionStale({ ...fresh, rulesVersion: 0 }, bumped)).toBe(false)
  })
})
