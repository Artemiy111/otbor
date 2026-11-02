import { describe, expect, test } from "bun:test"
import {
  generateHarnessToken,
  hashHarnessToken,
  hashesEqual,
  tokenMatchesHash
} from "../src/auth/harnessToken.ts"

describe("harness device tokens", () => {
  test("generates a strong, unique base64url token", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => generateHarnessToken()))

    expect(tokens.size).toBe(64)
    for (const token of tokens) {
      // 32 random bytes encode to 43 base64url characters.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  test("hashes are deterministic, hex and never the token", () => {
    const token = generateHarnessToken()
    const hash = hashHarnessToken(token)

    expect(hash).toBe(hashHarnessToken(token))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
  })

  test("matches only the correct token", () => {
    const token = generateHarnessToken()
    const hash = hashHarnessToken(token)

    expect(tokenMatchesHash(token, hash)).toBe(true)
    expect(tokenMatchesHash(generateHarnessToken(), hash)).toBe(false)
    expect(tokenMatchesHash(token, null)).toBe(false)
    expect(tokenMatchesHash("", hash)).toBe(false)
  })

  test("hash comparison rejects nulls and unequal lengths", () => {
    const hash = hashHarnessToken(generateHarnessToken())

    expect(hashesEqual(hash, hash)).toBe(true)
    expect(hashesEqual(hash, hashHarnessToken(generateHarnessToken()))).toBe(false)
    expect(hashesEqual(hash, null)).toBe(false)
    expect(hashesEqual(null, hash)).toBe(false)
    expect(hashesEqual("abcd", hash)).toBe(false)
  })
})
