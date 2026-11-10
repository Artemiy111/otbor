import type { Health, Overview } from "@otbor/contract"

/** Момент «сейчас» для всех тестов обзора. */
export const NOW = Date.parse("2026-11-10T12:00:00.000Z")

const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
export const ago = minutesAgo

/** Тихая система: всё работает, ничего не ждёт человека. */
export const makeOverview = (patch: Partial<Overview> = {}): Overview =>
  ({
    generatedAt: new Date(NOW).toISOString(),
    days: 7,
    applications: {
      byState: { draft: 0, preparing: 0, queued: 0, submitting: 0, submitted: 10, skipped: 0, needs_human: 0, failed: 0 },
      needsAttention: [],
      draftsToReview: 0,
      waiting: [],
      sentToday: 37,
      sentInWindow: 100,
      sentPrevWindow: 80
    },
    funnel: {
      vacanciesFound: 1000,
      decisionsApply: 200,
      decisionsSkip: 800,
      applicationsCreated: 150,
      sent: 100,
      viewed: 40,
      invited: 5,
      rejected: 20
    },
    skipReasons: [],
    timeline: [],
    accounts: [
      {
        id: "acc-1",
        name: "Иван",
        color: null,
        isDefault: true,
        session: "ok",
        sessionError: null,
        autoModes: [{ resumeId: null, resumeTitle: null, autoMode: "auto" }],
        usage: { used: 37, limit: 200, remaining: 163 },
        submitBlockedAt: null,
        submitBlockReason: null,
        submitRetryAt: null,
        captchas24h: 0,
        lastSentAt: minutesAgo(3),
        active: 4,
        needsAttention: 0
      }
    ],
    jobs: { stuck: [], running: [], pending: [], oldestPendingAgeSeconds: null },
    inbox: { unreadConversations: 0, lastInboundAt: null },
    events: [],
    ...patch
  }) as unknown as Overview

export const makeHealth = (patch: Partial<Health> = {}): Health =>
  ({
    status: "ok",
    version: "0.1.0",
    database: true,
    now: new Date(NOW).toISOString(),
    harnesses: [{ id: "h1", name: "browser", kinds: ["browser"], accounts: [], lastSeenAt: null, online: true }],
    ...patch
  }) as unknown as Health

/** Тихая система, у которой первый аккаунт изменён по `patch`. */
export const overviewWithAccount = (patch: Record<string, unknown>, rest: Partial<Overview> = {}): Overview => {
  const overview = makeOverview(rest)
  return { ...overview, accounts: [{ ...overview.accounts[0]!, ...patch }] } as unknown as Overview
}
