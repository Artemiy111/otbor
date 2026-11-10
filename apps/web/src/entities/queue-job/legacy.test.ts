import { describe, expect, test } from "bun:test"
import type { HarnessJob } from "@otbor/contract"
import { legacyPage } from "./api"

const job = (id: string, status: string, stage: string, payload: unknown = {}, result: unknown = null): HarnessJob =>
  ({
    id,
    kind: "browser",
    stage,
    status,
    priority: 0,
    payload,
    result,
    attempts: 1,
    maxAttempts: 3,
    leaseId: null,
    leaseEpoch: 0,
    runAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z"
  }) as unknown as HarnessJob

describe("legacyPage (сервер без QueueJobsSearch)", () => {
  const jobs = [
    job("1", "failed", "submit", { vacancyId: "v1", hhAccountId: "a1" }, { message: "boom" }),
    job("2", "done", "prepare"),
    job("3", "needs_human", "submit"),
    job("4", "pending", "form_read")
  ]

  test("несколько статусов и стадий, ссылки и ошибка из payload и результата", () => {
    const page = legacyPage(jobs, { status: ["failed", "needs_human"], stage: ["submit"], limit: 10, offset: 0 })
    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({ vacancyId: "v1", hhAccountId: "a1", lastError: "boom", accountName: null })
  })

  test("страницы режут отфильтрованный список, total остаётся полным", () => {
    const page = legacyPage(jobs, { limit: 2, offset: 2 })
    expect(page.total).toBe(4)
    expect(page.items.map((item) => String(item.id))).toEqual(["3", "4"])
  })
})
