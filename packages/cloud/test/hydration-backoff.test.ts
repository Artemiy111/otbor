import { describe, expect, test } from "bun:test"
import {
  HYDRATION_BACKOFF_CAP_SECONDS,
  HYDRATION_POISON_ATTEMPTS,
  backoffSeconds,
  isPoisoned
} from "../src/services/hydrationBackoff.ts"

describe("hydration backoff", () => {
  test("grows exponentially and stops at one day", () => {
    expect(backoffSeconds(1)).toBe(60)
    expect(backoffSeconds(2)).toBe(120)
    expect(backoffSeconds(3)).toBe(240)
    expect(backoffSeconds(11)).toBe(61_440)
    expect(backoffSeconds(12)).toBe(HYDRATION_BACKOFF_CAP_SECONDS)
    expect(backoffSeconds(50)).toBe(HYDRATION_BACKOFF_CAP_SECONDS)
  })

  test("attempt zero still waits one base delay", () => {
    expect(backoffSeconds(0)).toBe(60)
  })

  test("poison is a label, not a permanent ban", () => {
    expect(isPoisoned(HYDRATION_POISON_ATTEMPTS - 1)).toBe(false)
    expect(isPoisoned(HYDRATION_POISON_ATTEMPTS)).toBe(true)
    expect(backoffSeconds(99)).toBe(HYDRATION_BACKOFF_CAP_SECONDS)
  })
})
