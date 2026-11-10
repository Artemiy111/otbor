import { describe, expect, test } from "bun:test"
import { BlacklistRecord, BlacklistSource, BlacklistUpsert, QueueJob, QueueJobsSearch } from "@otbor/contract"
import { Schema } from "effect"

const job = {
  id: "0190a0a0-0000-7000-8000-000000000001",
  kind: "browser",
  stage: "prepare",
  status: "failed",
  priority: 0,
  payload: { vacancyId: "x" },
  attempts: 1,
  maxAttempts: 3,
  leaseId: null,
  leaseEpoch: 0,
  runAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  hhAccountId: "0190a0a0-0000-7000-8000-000000000002",
  accountName: "main",
  vacancyId: "0190a0a0-0000-7000-8000-000000000003",
  vacancyTitle: "Go",
  applicationId: null,
  lastError: "boom"
}

describe("QueueJobsSearch", () => {
  test("задача несёт аккаунт, вакансию и ошибку; null допустим", () => {
    const decoded = Schema.decodeUnknownSync(QueueJob)(job)
    expect(decoded.accountName).toBe("main")
    expect(Schema.decodeUnknownSync(QueueJob)({ ...job, hhAccountId: null, accountName: null, lastError: null }).lastError)
      .toBeNull()
  })

  test("запрос принимает списки статусов и стадий и отвергает неизвестные", () => {
    const payload = Schema.decodeUnknownSync(QueueJobsSearch.payloadSchema)({
      status: ["needs_human", "failed"],
      stage: ["submit"],
      limit: 50,
      offset: 100
    })
    expect(payload.status).toEqual(["needs_human", "failed"])
    expect(() => Schema.decodeUnknownSync(QueueJobsSearch.payloadSchema)({ status: ["bogus"] })).toThrow()
  })
})

describe("исключения", () => {
  test("источник reject и внутренние id", () => {
    expect(Schema.decodeUnknownSync(BlacklistSource)("reject")).toBe("reject")
    const record = Schema.decodeUnknownSync(BlacklistRecord)({
      id: "0190a0a0-0000-7000-8000-000000000001",
      scope: "resume",
      resumeId: "0190a0a0-0000-7000-8000-000000000002",
      targetType: "vacancy",
      externalId: "123",
      vacancyId: "0190a0a0-0000-7000-8000-000000000003",
      source: "reject",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })
    expect(String(record.vacancyId)).toBe("0190a0a0-0000-7000-8000-000000000003")
  })

  test("BlacklistUpsert принимает resumeId", () => {
    const payload = Schema.decodeUnknownSync(BlacklistUpsert.payloadSchema)({
      scope: "resume",
      resumeId: "0190a0a0-0000-7000-8000-000000000002",
      targetType: "vacancy",
      externalId: "123"
    })
    expect(String(payload.resumeId)).toBe("0190a0a0-0000-7000-8000-000000000002")
  })
})
