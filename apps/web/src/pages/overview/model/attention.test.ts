import { describe, expect, test } from "bun:test"
import type { CrawlSchedule } from "@otbor/contract"
import { buildAttention, type AttentionInput } from "./attention"
import { ago, makeHealth, makeOverview, NOW, overviewWithAccount } from "./overview.fixture"

const base = (patch: Partial<AttentionInput> = {}): AttentionInput => ({
  overview: makeOverview(),
  health: makeHealth(),
  healthFailed: false,
  schedules: [],
  proxy: undefined,
  now: NOW,
  ...patch
})

const schedule = (patch: Record<string, unknown>): CrawlSchedule =>
  ({
    id: "s1",
    kind: "search",
    targetId: "https://hh.ru/search/vacancy?text=devops",
    intervalMinutes: 60,
    options: {},
    enabled: true,
    nextRunAt: new Date(NOW + 600_000).toISOString(),
    lastRunAt: null,
    lastError: null,
    createdAt: ago(1000),
    updatedAt: ago(1000),
    ...patch
  }) as unknown as CrawlSchedule

describe("buildAttention", () => {
  test("в спокойной системе список пуст", () => {
    expect(buildAttention(base())).toEqual([])
  })

  test("сервер недоступен: одна срочная строка", () => {
    const items = buildAttention(base({ overview: undefined, health: undefined, healthFailed: true }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "server-down", tone: "danger" })
  })

  test("порядок: срочное, потом требует решения, потом к сведению", () => {
    const overview = makeOverview({
      applications: {
        ...makeOverview().applications,
        draftsToReview: 12,
        needsAttention: [
          { state: "needs_human", reason: "form_read_failed", count: 5, oldestAt: ago(180) },
          { state: "failed", reason: "submit_not_sent", count: 2, oldestAt: ago(30) }
        ]
      },
      inbox: { unreadConversations: 3, lastInboundAt: ago(10) }
    })
    const items = buildAttention(base({ overview }))
    expect(items.map((item) => item.tone)).toEqual(["danger", "warning", "info", "info"])
    expect(items.map((item) => item.id)).toEqual([
      "apps-failed-submit_not_sent",
      "apps-needs_human-form_read_failed",
      "drafts",
      "inbox"
    ])
  })

  test("формулировка группы откликов: число, причина, возраст, ссылка с фильтром", () => {
    const overview = makeOverview({
      applications: {
        ...makeOverview().applications,
        needsAttention: [{ state: "needs_human", reason: "form_read_failed", count: 5, oldestAt: ago(180) }]
      }
    })
    const [item] = buildAttention(base({ overview }))
    expect(item?.title).toBe("5 откликов: форму не удалось прочитать")
    expect(item?.detail).toBe("самое старое — 3 ч назад")
    expect(item?.action).toEqual({ kind: "link", label: "Открыть", href: "/applications?state=needs_human" })
  })

  test("склонение: 1 отклик, 2 отклика", () => {
    const make = (count: number) =>
      buildAttention(
        base({
          overview: makeOverview({
            applications: {
              ...makeOverview().applications,
              needsAttention: [{ state: "needs_human", reason: null, count, oldestAt: null }]
            }
          })
        })
      )[0]?.title
    expect(make(1)).toBe("1 отклик: нужно ваше решение")
    expect(make(2)).toBe("2 отклика: нужно ваше решение")
    expect(make(11)).toBe("11 откликов: нужно ваше решение")
  })

  test("капча на аккаунте даёт кнопку «Повторить сейчас» и время повтора", () => {
    const overview = overviewWithAccount({
      submitBlockedAt: ago(5),
      submitBlockReason: "captcha",
      submitRetryAt: new Date(NOW + 12 * 60_000).toISOString()
    })
    const [item] = buildAttention(base({ overview }))
    expect(item).toMatchObject({ id: "captcha-acc-1", tone: "warning" })
    expect(item?.action).toMatchObject({ kind: "retry-captcha", accountId: "acc-1" })
    expect(item?.detail).toContain("через 12 мин")
  })

  test("серия одинаковых отказов: своя причина, текст ошибки и ссылка на аккаунты", () => {
    const overview = overviewWithAccount({
      submitBlockedAt: ago(5),
      submitBlockReason: "repeated_failure",
      submitBlockDetail: `the resume "DevOps" (291000851) did not appear in hh's resume select`,
      submitRetryAt: new Date(NOW + 12 * 60_000).toISOString()
    })
    const [item] = buildAttention(base({ overview }))
    expect(item).toMatchObject({ id: "pause-acc-1", tone: "warning" })
    expect(item?.title).toContain("5 раз подряд")
    expect(item?.detail).toContain("Резюме не появилось")
    expect(item?.action).toMatchObject({ kind: "link", href: "/accounts" })
  })

  test("истёкшая сессия — срочно и называет аккаунт", () => {
    const overview = overviewWithAccount({ session: "expired" })
    const [item] = buildAttention(base({ overview }))
    expect(item).toMatchObject({ tone: "danger", icon: "session" })
    expect(item?.title).toContain("Иван")
  })

  test("нет исполнителя браузера: срочно, если очередь не пуста", () => {
    const health = makeHealth({ harnesses: [] })
    const overview = makeOverview({
      jobs: { stuck: [], running: [], pending: [{ stage: "submit", count: 4 }], oldestPendingAgeSeconds: 60 }
    })
    expect(buildAttention(base({ health, overview }))[0]).toMatchObject({ id: "no-executor", tone: "danger" })
    expect(buildAttention(base({ health }))[0]).toMatchObject({ id: "no-executor", tone: "warning" })
  })

  test("needs_reconcile объясняется человеческими словами", () => {
    const overview = makeOverview({
      jobs: {
        stuck: [{ status: "needs_reconcile", stage: "submit", count: 3, oldestAt: ago(60) }],
        running: [],
        pending: [],
        oldestPendingAgeSeconds: null
      }
    })
    const item = buildAttention(base({ overview })).find((row) => row.id === "reconcile")
    expect(item?.title).toBe("3 отклика: не ясно, ушёл ли отклик — идёт сверка")
  })

  test("исчерпанный дневной лимит — только к сведению", () => {
    const overview = overviewWithAccount({ usage: { used: 200, limit: 200, remaining: 0 } })
    const [item] = buildAttention(base({ overview }))
    expect(item).toMatchObject({ id: "limit-acc-1", tone: "info" })
  })

  test("расписания: ошибка и опоздание группируются, выключенные по одному не шумят", () => {
    const schedules = [
      schedule({ id: "a", lastError: "fetch failed: ECONNRESET" }),
      schedule({ id: "b", kind: "mail_sync", nextRunAt: new Date(NOW - 3 * 3600_000).toISOString() }),
      schedule({ id: "c", enabled: false })
    ]
    const items = buildAttention(base({ schedules }))
    expect(items.map((item) => item.id)).toEqual(["schedules-error", "schedules-overdue"])
    expect(items[0]?.title).toContain("devops")
    expect(items[0]?.detail).toContain("сбой сети")
  })

  test("все расписания выключены — подсказка к сведению", () => {
    const items = buildAttention(base({ schedules: [schedule({ enabled: false })] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "schedules-off", tone: "info" })
  })

  test("ни один прокси-узел не отвечает — предупреждение", () => {
    const proxy = {
      configured: true,
      engine: { reachable: true, nodes: 4, alive: 0, checked: 4 }
    } as unknown as AttentionInput["proxy"]
    expect(buildAttention(base({ proxy }))[0]).toMatchObject({ id: "proxy-dead", tone: "warning" })
  })
})
