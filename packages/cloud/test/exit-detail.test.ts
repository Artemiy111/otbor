import { describe, expect, test } from "bun:test"
import { exitDetail } from "../src/services/QueueService.ts"

describe("exitDetail", () => {
  test("keeps only the tag when the harness gave no message", () => {
    expect(exitDetail({ tag: "inference_failed" })).toBe("inference_failed")
    expect(exitDetail({ tag: "inference_failed", message: "  " })).toBe("inference_failed")
  })

  test("appends the harness message on one line", () => {
    expect(exitDetail({ tag: "inference_failed", message: "agent\nexited   1" })).toBe(
      "inference_failed: agent exited 1"
    )
  })

  test("truncates a long message to about 500 characters", () => {
    const text = exitDetail({ tag: "inference_failed", message: "x".repeat(2000) })
    expect(text.startsWith("inference_failed: ")).toBe(true)
    expect(text.length).toBeLessThanOrEqual("inference_failed: ".length + 500)
    expect(text.endsWith("...")).toBe(true)
  })
})
