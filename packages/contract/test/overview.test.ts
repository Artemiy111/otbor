import { describe, expect, test } from "bun:test"
import { Overview, OverviewGet } from "@otbor/contract"
import { Schema } from "effect"

const snapshot = {
  generatedAt: "2026-11-10T10:00:00.000Z",
  days: 2,
  applications: {
    byState: { draft: 1, preparing: 2, queued: 0, submitting: 0, submitted: 5, skipped: 0, needs_human: 1, failed: 0 },
    needsAttention: [{ state: "needs_human", reason: "captcha", count: 1, oldestAt: "2026-11-09T10:00:00.000Z" }],
    draftsToReview: 1,
    waiting: [{ reason: "daily_cap", count: 2, nextRetryAt: null }],
    sentToday: 3,
    sentInWindow: 5,
    sentPrevWindow: 4
  },
  funnel: {
    vacanciesFound: 10,
    decisionsApply: 4,
    decisionsSkip: 6,
    applicationsCreated: 5,
    sent: 5,
    viewed: 2,
    invited: 1,
    rejected: 1
  },
  skipReasons: [{ code: "blocked_filter", count: 6 }],
  timeline: [
    { day: "2026-11-09", found: 4, sent: 2, invited: 0 },
    { day: "2026-11-10", found: 6, sent: 3, invited: 1 }
  ],
  accounts: [{
    id: "0190a0a0-0000-7000-8000-000000000001",
    name: "main",
    color: null,
    isDefault: true,
    session: "ok",
    sessionError: null,
    autoModes: [{ resumeId: null, resumeTitle: null, autoMode: "auto" }],
    usage: { used: 3, limit: 200, remaining: 197 },
    submitBlockedAt: null,
    submitBlockReason: null,
    submitRetryAt: null,
    captchas24h: 0,
    lastSentAt: null,
    active: 2,
    needsAttention: 1
  }],
  jobs: {
    stuck: [{ status: "needs_human", stage: "submit", count: 1, oldestAt: "2026-11-09T10:00:00.000Z" }],
    running: [{ stage: "form_read", count: 1 }],
    pending: [],
    oldestPendingAgeSeconds: null
  },
  inbox: { unreadConversations: 2, lastInboundAt: null },
  events: [{
    at: "2026-11-10T09:00:00.000Z",
    kind: "sent",
    title: "Backend",
    subtitle: null,
    vacancyId: "0190a0a0-0000-7000-8000-000000000002",
    applicationId: null,
    hhAccountId: null
  }]
}

describe("Overview", () => {
  test("decodes a hand-built snapshot", () => {
    const decoded = Schema.decodeUnknownSync(Overview)(snapshot)
    expect(decoded.timeline).toHaveLength(2)
    expect(decoded.accounts[0]?.usage.remaining).toBe(197)
    expect(OverviewGet._tag).toBe("OverviewGet")
  })

  test("rejects an unknown event kind and a fractional count", () => {
    const bad = { ...snapshot, events: [{ ...snapshot.events[0], kind: "nope" }] }
    expect(() => Schema.decodeUnknownSync(Overview)(bad)).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Overview)({ ...snapshot, inbox: { unreadConversations: 1.5, lastInboundAt: null } })
    ).toThrow()
  })
})
