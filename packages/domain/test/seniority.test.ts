import { describe, expect, test } from "bun:test"
import { detectSeniority } from "../src/seniority.ts"

describe("detectSeniority", () => {
  test("detects from the title", () => {
    expect(detectSeniority("Junior DevOps")).toBe("junior")
    expect(detectSeniority("Middle SRE")).toBe("middle")
    expect(detectSeniority("Senior Platform Engineer")).toBe("senior")
    expect(detectSeniority("Руководитель DevOps")).toBe("lead")
  })

  test("lead wins over senior when both are present", () => {
    expect(detectSeniority("Senior Team Lead")).toBe("lead")
  })

  test("falls back to the body", () => {
    expect(detectSeniority("DevOps инженер", "Опыт от 6 лет, senior-уровень")).toBe("senior")
  })

  test("returns unknown without a marker", () => {
    expect(detectSeniority("DevOps инженер")).toBe("unknown")
  })
})
