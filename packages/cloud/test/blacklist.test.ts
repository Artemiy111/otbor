import { describe, expect, test } from "bun:test"
import {
  matchedLayers,
  matchedScopes,
  primaryMatch,
  validateInput,
  type BlacklistCandidate
} from "../src/repositories/BlacklistRepository.ts"

const candidate = (
  overrides: Partial<BlacklistCandidate> = {}
): BlacklistCandidate => ({
  scope: "app",
  hhAccountId: null,
  type: "employer",
  externalId: "emp-1",
  ...overrides
})

describe("blacklist scope and account validation", () => {
  test("app rows carry no account", () => {
    expect(validateInput({ scope: "app", externalId: "emp-1" })).toBeNull()
    expect(
      validateInput({ scope: "app", hhAccountId: "0190f0aa-0000-7000-8000-000000000001", externalId: "emp-1" })
    ).toContain("must not have an hhAccountId")
  })

  test("account-level rows require an account", () => {
    expect(validateInput({ scope: "hh_account", externalId: "emp-1" })).toContain(
      "requires an hhAccountId"
    )
    expect(validateInput({ scope: "hh_native", externalId: "emp-1" })).toContain(
      "requires an hhAccountId"
    )
    expect(
      validateInput({
        scope: "hh_account",
        hhAccountId: "0190f0aa-0000-7000-8000-000000000001",
        externalId: "emp-1"
      })
    ).toBeNull()
  })

  test("a blank target is rejected", () => {
    expect(validateInput({ scope: "app", externalId: "   " })).toContain("must not be empty")
  })
})

describe("blacklist layer matching", () => {
  test("layers stack and an account layer only applies to its own account", () => {
    const candidates = [
      candidate({ scope: "app", externalId: "emp-1" }),
      candidate({ scope: "hh_account", hhAccountId: "account-a", externalId: "emp-1" }),
      candidate({ scope: "hh_native", hhAccountId: "account-b", externalId: "emp-1" })
    ]

    const forA = matchedLayers(candidates, {
      hhAccountId: "account-a",
      employerExternalId: "emp-1",
      vacancyExternalId: "vac-1"
    })
    expect(forA.map((match) => `${match.scope}:${match.target}`)).toEqual([
      "app:employer",
      "hh_account:employer"
    ])
    expect(matchedScopes(forA)).toEqual(["app", "hh_account"])

    const forB = matchedLayers(candidates, {
      hhAccountId: "account-b",
      employerExternalId: "emp-1",
      vacancyExternalId: "vac-1"
    })
    expect(matchedScopes(forB)).toEqual(["app", "hh_native"])

    const withoutAccount = matchedLayers(candidates, {
      employerExternalId: "emp-1",
      vacancyExternalId: "vac-1"
    })
    expect(matchedScopes(withoutAccount)).toEqual(["app"])
  })

  test("a vacancy target and an employer target both match by external id", () => {
    const candidates = [
      candidate({ scope: "app", type: "employer", externalId: "emp-1" }),
      candidate({ scope: "app", type: "vacancy", externalId: "vac-1" })
    ]

    const matches = matchedLayers(candidates, {
      employerExternalId: "emp-1",
      vacancyExternalId: "vac-1"
    })
    expect(matches.map((match) => match.target).sort()).toEqual(["employer", "vacancy"])
    expect(primaryMatch(matches)?.target).toBe("employer")
  })

  test("unrelated external ids do not match", () => {
    expect(
      matchedLayers([candidate({ externalId: "other" })], {
        employerExternalId: "emp-1",
        vacancyExternalId: "vac-1"
      })
    ).toEqual([])
  })
})
