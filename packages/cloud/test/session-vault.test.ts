import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { decryptSession, encryptSession } from "../src/auth/sessionVault.ts"

describe("sessionVault", () => {
  const key = randomBytes(32)

  test("шифрует и расшифровывает cookies без потерь", () => {
    const state = JSON.stringify({ cookies: [{ name: "hhtoken", value: "секрет" }], origins: [] })
    const sealed = encryptSession(state, key)
    expect(sealed).not.toContain("hhtoken")
    expect(decryptSession(sealed, key)).toBe(state)
  })

  test("один и тот же текст даёт разный шифртекст", () => {
    expect(encryptSession("x", key)).not.toBe(encryptSession("x", key))
  })

  test("чужой ключ и подмена данных отвергаются", () => {
    const sealed = encryptSession("x", key)
    expect(() => decryptSession(sealed, randomBytes(32))).toThrow()
    const parts = sealed.split(".")
    parts[3] = Buffer.from("подмена").toString("base64url")
    expect(() => decryptSession(parts.join("."), key)).toThrow()
  })
})
