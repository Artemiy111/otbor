import { describe, expect, test } from "bun:test"
import { chooseDraft, resumeHashOfId, resumeIdOfHash, resumeToSelect } from "../src/resumePick.ts"

const resumes = [
  { id: "1001", hash: "aaaa00000000000000000000000000000000aa01", title: "Dev" },
  { id: "1002", hash: "bbbb00000000000000000000000000000000bb02", title: "Dev" }
]
const draft = (resumeExternalId: string | null) => ({ resumeExternalId })

describe("id <-> hash", () => {
  test("two resumes with one title are told apart by id", () => {
    expect(resumeIdOfHash(resumes, resumes[1]!.hash)).toBe("1002")
    expect(resumeHashOfId(resumes, "1001")).toBe(resumes[0]!.hash)
    expect(resumeIdOfHash(resumes, "unknown")).toBeNull()
    expect(resumeIdOfHash(resumes, null)).toBeNull()
    expect(resumeHashOfId(resumes, "9")).toBeNull()
  })
})

describe("chooseDraft", () => {
  const a = draft("1001")
  const b = draft("1002")
  test("takes the draft of the selected resume", () => {
    expect(chooseDraft([a, b], "1002")).toEqual({ draft: b, matched: true })
  })
  test("the only draft is used, unmatched when the selected resume is another", () => {
    expect(chooseDraft([a], "1002")).toEqual({ draft: a, matched: false })
    expect(chooseDraft([a], null)).toEqual({ draft: a, matched: true })
  })
  test("several drafts and an unknown selection give none", () => {
    expect(chooseDraft([a, b], null)).toBeNull()
    expect(chooseDraft([a, b], "9")).toBeNull()
  })
})

describe("resumeToSelect", () => {
  test("switches only to the one identified draft", () => {
    expect(resumeToSelect([draft("1001")], "1002")).toEqual(draft("1001"))
    expect(resumeToSelect([draft("1001"), draft("1002")], "1002")).toBeNull()
    expect(resumeToSelect([draft("1001"), draft("1002")], "9")).toBeNull()
    expect(resumeToSelect([draft(null)], "1002")).toBeNull()
    expect(resumeToSelect([draft("1001")], null)).toBeNull()
  })
})
