import { describe, expect, test } from "bun:test"
import { QueueConcurrency, QueueConcurrencyGet, UserSettings } from "@otbor/contract"
import { Schema } from "effect"

const base = {
  browserCap: 4,
  actingCap: 1,
  submitIntervalSeconds: 75,
  submitJitterPercent: 50,
  submitHourlyLimit: null,
  harnessSlots: 6,
  actingStages: ["submit", "letter_attach"],
  harnesses: [],
  accounts: [],
  unassigned: { running: [], pending: [] },
  inference: { running: 1, pending: 2 }
}

describe("QueueConcurrency", () => {
  test("decodes a snapshot; a harness may not have reported its slots yet", () => {
    const decoded = Schema.decodeUnknownSync(QueueConcurrency)({
      ...base,
      harnesses: [{
        id: "0190a0a0-0000-7000-8000-000000000001",
        name: "mac",
        slots: null,
        busy: 0,
        lastSeenAt: null
      }]
    })
    expect(decoded.harnesses[0]?.slots).toBeNull()
    expect(QueueConcurrencyGet._tag).toBe("QueueConcurrencyGet")
  })

  test("rejects an unknown stage", () => {
    expect(() => Schema.decodeUnknownSync(QueueConcurrency)({ ...base, actingStages: ["nope"] })).toThrow()
  })
})

describe("UserSettings", () => {
  const ok = {
    accountBrowserConcurrency: 4,
    accountActingConcurrency: 1,
    submitIntervalSeconds: 75,
    submitJitterPercent: 50,
    submitHourlyLimit: null,
    harnessSlots: 6
  }

  test("accepts a full row and a limit", () => {
    expect(Schema.decodeUnknownSync(UserSettings)({ ...ok, submitHourlyLimit: 30 }).submitHourlyLimit).toBe(30)
  })

  test("rejects values outside the ranges", () => {
    for (const bad of [
      { harnessSlots: 13 },
      { harnessSlots: 0 },
      { accountBrowserConcurrency: 0 },
      { submitIntervalSeconds: -1 },
      { submitJitterPercent: 201 },
      { submitHourlyLimit: 0 }
    ]) {
      expect(() => Schema.decodeUnknownSync(UserSettings)({ ...ok, ...bad })).toThrow()
    }
  })
})
