import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/** 256 bits of entropy: enough that guessing a token is not a threat model. */
const TOKEN_BYTES = 32

/**
 * A harness device token. It is returned in plaintext exactly once, from
 * `HarnessRegister`, and only its SHA-256 hash is persisted.
 */
export const generateHarnessToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url")

export const hashHarnessToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex")

/**
 * Compares two hex digests without an early exit, so a caller cannot learn the
 * stored hash byte by byte from response timing.
 */
export const hashesEqual = (left: string | null, right: string | null): boolean => {
  if (left === null || right === null) return false
  const a = Buffer.from(left, "hex")
  const b = Buffer.from(right, "hex")
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

/** Verification helper for a plaintext token against a stored hash. */
export const tokenMatchesHash = (token: string, storedHash: string | null): boolean =>
  token.length > 0 && hashesEqual(hashHarnessToken(token), storedHash)
