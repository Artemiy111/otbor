import { describe, expect, test } from "bun:test"
import { pathWithTarget, resolveTarget, searchWithTarget, targetFromSearch } from "./target"

const accounts = [
  { id: "a1", isDefault: false },
  { id: "a2", isDefault: true }
]
const resumes = [
  { id: "r1", hhAccountId: "a1" },
  { id: "r2", hhAccountId: "a2" }
]

describe("resolveTarget", () => {
  test("empty selection falls back to the default account", () => {
    expect(resolveTarget(accounts, resumes, true, { accountId: "", resumeId: null })).toEqual({
      accountId: "a2",
      resumeId: null
    })
  })
  test("keeps a valid pair", () => {
    expect(resolveTarget(accounts, resumes, true, { accountId: "a1", resumeId: "r1" })).toEqual({
      accountId: "a1",
      resumeId: "r1"
    })
  })
  test("a resume of another account is dropped", () => {
    expect(resolveTarget(accounts, resumes, true, { accountId: "a1", resumeId: "r2" }).resumeId).toBeNull()
  })
  test("resumes not loaded yet: the resume from the URL survives", () => {
    expect(resolveTarget(accounts, [], false, { accountId: "a1", resumeId: "r1" }).resumeId).toBe("r1")
  })
  test("no accounts yet: the wish is returned untouched", () => {
    const wanted = { accountId: "x", resumeId: "y" }
    expect(resolveTarget([], [], false, wanted)).toBe(wanted)
  })
})

describe("url helpers", () => {
  test("pathWithTarget carries account and resume", () => {
    expect(pathWithTarget("/auto-apply", { accountId: "a1", resumeId: "r1" })).toBe("/auto-apply?account=a1&resume=r1")
    expect(pathWithTarget("/auto-apply", { accountId: "a1", resumeId: null })).toBe("/auto-apply?account=a1")
    expect(pathWithTarget("/auto-apply", { accountId: "", resumeId: null })).toBe("/auto-apply")
  })
  test("targetFromSearch reads both keys", () => {
    expect(targetFromSearch("?account=a1&resume=r1")).toEqual({ accountId: "a1", resumeId: "r1" })
    expect(targetFromSearch("")).toEqual({ accountId: "", resumeId: null })
  })
  test("searchWithTarget keeps other params and drops a cleared resume", () => {
    expect(searchWithTarget("?tab=x&resume=r1", { accountId: "a1", resumeId: null })).toBe("?tab=x&account=a1")
  })
})
