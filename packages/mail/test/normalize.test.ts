import { describe, expect, test } from "bun:test"
import {
  SNIPPET_LIMIT,
  htmlToText,
  normalizeAddress,
  normalizeMessageId,
  normalizeMessageIds,
  plainText,
  snippetOf,
  syntheticMessageId,
  toMailAddresses
} from "../src/index.ts"

describe("address normalization", () => {
  test("lowercases and trims the address, keeps the display name", () => {
    expect(normalizeAddress(" IVAN@Example.COM ")).toBe("ivan@example.com")
    expect(
      toMailAddresses([
        { name: "  Иван  ", address: " IVAN@Example.COM " },
        { name: null, address: "second@example.com" },
        { name: "dropped", address: "  " },
        {}
      ])
    ).toEqual([
      { name: "Иван", address: "ivan@example.com" },
      { name: null, address: "second@example.com" }
    ])
  })

  test("turns a missing name into null", () => {
    expect(toMailAddresses([{ address: "a@example.com" }])).toEqual([
      { name: null, address: "a@example.com" }
    ])
    expect(toMailAddresses(undefined)).toEqual([])
  })
})

describe("message ids", () => {
  test("strips angle brackets and whitespace", () => {
    expect(normalizeMessageId(" <abc@example.com> ")).toBe("abc@example.com")
    expect(normalizeMessageId("<<abc@example.com>>")).toBe("abc@example.com")
    expect(normalizeMessageId("  ")).toBeNull()
    expect(normalizeMessageId(null)).toBeNull()
  })

  test("normalizes the References header in both shapes", () => {
    expect(normalizeMessageIds("<a@x> <b@x>")).toEqual(["a@x", "b@x"])
    expect(normalizeMessageIds(["<a@x>", " b@x ", ""])).toEqual(["a@x", "b@x"])
    expect(normalizeMessageIds(undefined)).toEqual([])
  })

  test("synthesizes a stable fallback from account, folder and uid", () => {
    const id = syntheticMessageId("Me@Example.com", "INBOX", 42)
    expect(id).toBe(syntheticMessageId("me@example.com", "INBOX", 42))
    expect(id).toMatch(/^synthetic-[0-9a-f]{24}@mail\.otbor$/)
    expect(id).not.toBe(syntheticMessageId("me@example.com", "INBOX", 43))
    expect(id).not.toBe(syntheticMessageId("me@example.com", "Sent", 42))
  })
})

describe("body text", () => {
  test("converts HTML, drops scripts and decodes entities", () => {
    const text = htmlToText(
      "<style>p{color:red}</style><p>Hello&nbsp;<b>Ivan</b>!</p><ul><li>one</li><li>two</li></ul><script>alert(1)</script>"
    )
    expect(text).toContain("Hello Ivan!")
    expect(text).toContain("• one")
    expect(text).toContain("• two")
    expect(text).not.toContain("alert")
    expect(text).not.toContain("color:red")
  })

  test("prefers text/plain and falls back to HTML", () => {
    expect(plainText({ text: "plain body", html: "<p>html body</p>" })).toBe("plain body")
    expect(plainText({ text: "  ", html: "<p>html body</p>" })).toBe("html body")
    expect(plainText({ text: undefined, html: false })).toBe("")
  })

  test("collapses whitespace and caps the snippet", () => {
    expect(snippetOf("a\n\n  b   c")).toBe("a b c")
    const long = "word ".repeat(200)
    const snippet = snippetOf(long)
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LIMIT)
    expect(snippet.endsWith("…")).toBe(true)
    expect(snippetOf(long, 10)).toBe("word word…")
  })
})
