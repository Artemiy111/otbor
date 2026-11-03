import type { HarnessExit } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { judgeNegotiationsSync } from "../src/services/applyRules.ts"

/** Synthetic hand-written fixtures from packages/hh; see negotiations.test.ts there. */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")

const detailed = fixture("synthetic-negotiations-detailed.html")
const plain = fixture("synthetic-negotiations.html")
const empty = fixture("synthetic-negotiations-empty.html")

const page = (html: string, index = 0) => ({
  url: `https://hh.ru/applicant/negotiations?page=${index}`,
  html
})

const exit = (pages: ReadonlyArray<ReturnType<typeof page>>, tag: HarnessExit["tag"] = "reconciled"): HarnessExit => ({
  tag,
  artifacts: { pages }
})

describe("judgeNegotiationsSync", () => {
  test("reads topics from the pages and merges duplicates across pages", () => {
    const verdict = judgeNegotiationsSync(exit([page(plain), page(empty, 1)]))
    expect(verdict._tag).toBe("read")
    if (verdict._tag !== "read") return
    expect(verdict.topics.map((topic) => topic.vacancyId)).toEqual(["100500", "200600"])
    expect(verdict.pages).toBe(2)
    // The list ran to an empty page: it was read to its end.
    expect(verdict.complete).toBe(true)
  })

  test("a list that stops before its last page or an empty one is not complete", () => {
    const verdict = judgeNegotiationsSync(exit([page(detailed)]))
    expect(verdict._tag === "read" && verdict.complete).toBe(false)
  })

  test("reaching the reported page count is complete", () => {
    const verdict = judgeNegotiationsSync(exit([page(detailed, 0), page(detailed, 1), page(detailed, 2)]))
    expect(verdict._tag === "read" && verdict.complete).toBe(true)
  })

  test("an unreadable later page keeps what was read but is not complete", () => {
    const verdict = judgeNegotiationsSync(exit([page(plain), page("<html>oops</html>", 1)]))
    expect(verdict._tag).toBe("read")
    if (verdict._tag === "read") {
      expect(verdict.topics).toHaveLength(2)
      expect(verdict.pages).toBe(1)
      expect(verdict.complete).toBe(false)
    }
  })

  test("no readable page is a retry, never an empty list", () => {
    expect(judgeNegotiationsSync(exit([page("<html>oops</html>")]))._tag).toBe("retry")
    expect(judgeNegotiationsSync(exit([]))._tag).toBe("retry")
    expect(judgeNegotiationsSync({ tag: "reconciled" })._tag).toBe("retry")
  })

  test("login and captcha need a human; other tags are retried", () => {
    expect(judgeNegotiationsSync({ tag: "session_expired" })._tag).toBe("human")
    expect(judgeNegotiationsSync({ tag: "captcha" })._tag).toBe("human")
    expect(judgeNegotiationsSync({ tag: "transport" })._tag).toBe("retry")
    expect(
      judgeNegotiationsSync(exit([{ url: "https://hh.ru/account/login", html: "<html>login</html>" }]))._tag
    ).toBe("human")
  })

  test("a bare tag is not a result", () => {
    expect(judgeNegotiationsSync({ tag: "submitted" })._tag).toBe("retry")
  })
})
