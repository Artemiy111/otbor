import { describe, expect, test } from "bun:test"
import { failureReason } from "../src/services/CrawlRunner.ts"
import { toCrawlSchedule, type StoredSchedule } from "../src/repositories/ScheduleRepository.ts"

const outcome = (
  status: "done" | "stopped" | "error",
  reason: string | null
) => ({
  status,
  reason,
  nextPage: 1,
  pagesDone: 1,
  found: 20,
  inserted: 20,
  updated: 0,
  skipped: 0,
  errors: 0,
  totalResults: 20,
  pagesTotal: 1
})

describe("schedule error text", () => {
  test("a bounded run that reaches its page limit is not an error", () => {
    expect(failureReason(outcome("done", "last_page"))).toBeNull()
    expect(failureReason(outcome("stopped", "max_pages"))).toBeNull()
    expect(failureReason(outcome("stopped", "empty_page"))).toBeNull()
    expect(failureReason(outcome("stopped", "cancelled"))).toBeNull()
  })

  test("a block, transport failure or parse error is recorded", () => {
    expect(failureReason(outcome("stopped", "search_blocked_captcha"))).toBe(
      "search_blocked_captcha"
    )
    expect(failureReason(outcome("stopped", "http_429"))).toBe("http_429")
    expect(failureReason(outcome("error", "parse_error"))).toBe("parse_error")
    expect(failureReason(outcome("stopped", null))).toBeNull()
  })
})

describe("schedule mapping", () => {
  test("a stored row maps to the wire record with ISO timestamps", () => {
    const row: StoredSchedule = {
      id: "0190f0aa-0000-7000-8000-000000000001",
      userId: "local-user",
      kind: "search",
      targetId: "https://hh.ru/search/vacancy?text=devops",
      intervalMinutes: 60,
      options: {},
      enabled: true,
      nextRunAt: new Date("2026-11-02T12:00:00.000Z"),
      lastRunAt: null,
      lastError: null,
      createdAt: new Date("2026-11-01T10:00:00.000Z"),
      updatedAt: new Date("2026-11-01T10:00:00.000Z")
    }

    expect(toCrawlSchedule(row)).toMatchObject({
      id: row.id,
      kind: "search",
      targetId: row.targetId,
      intervalMinutes: 60,
      enabled: true,
      nextRunAt: "2026-11-02T12:00:00.000Z",
      lastRunAt: null,
      lastError: null,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z"
    })
  })
})
