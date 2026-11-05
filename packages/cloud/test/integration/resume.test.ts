import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ResumeService } from "../../src/services/ResumeService.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("resume integration suite is opt-in", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  // Use beforeAll/afterAll via describe? We'll inline setup with a single test using global.
  // Simpler: one describe with beforeAll.
  describe("resume management", () => {
    // @ts-ignore
    beforeAll(async () => {
      await support.createTestDatabase(base)
      await support.migrateTestDatabase(base)
      process.env.DATABASE_URL = support.testDatabaseUrl(base)
    }, 120_000)
    // @ts-ignore
    afterAll(async () => {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      await support.dropTestDatabase(base)
    }, 60_000)

    test("CRUD + enrichment + RLS", async () => {
      const t1 = await support.seedTenant("resume-a")
      const t2 = await support.seedTenant("resume-b")

      const r1 = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.upsert({
            hhAccountId: t1.accountId as any,
            source: "hh",
            externalId: "resume-ext-1",
            title: "Senior Engineer",
            text: "resume text",
            about: "about",
            skills: ["TS"],
            experience: [],
            education: [],
            workFormats: ["remote"],
            isActive: true
          })
        })
      )

      const got = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.get(r1.id)
        })
      )
      expect(got.title).toBe("Senior Engineer")
      expect(got.skills).toEqual(["TS"])

      const list = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.list(t1.accountId as any)
        })
      )
      expect(list.length).toBe(1)

      const saved = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.enrichmentSave(r1.id, {
            comment: "good",
            salaries: [
              { currency: "RUB", min: 100000, expectation: 150000 },
              { currency: "USD", min: null, expectation: 3000 }
            ],
            faq: [{ key: "city", answer: "Москва" }, { key: "x", question: "Свой?", answer: " да " }],
            experience: [{ key: "exp1", employmentType: "full", comment: "c", leaveReason: "r" }]
          })
        })
      )
      expect(saved.comment).toBe("good")
      expect(saved.experience.length).toBe(1)

      const enr = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.enrichmentGet(r1.id)
        })
      )
      expect(enr.salaryMin).toBe(100000)
      expect(enr.salaries.length).toBe(2)
      expect(enr.salaries[1]?.currency).toBe("USD")
      expect(enr.faq.map((e) => e.answer)).toEqual(["Москва", "да"])

      const r2 = await support.runAs(
        t1.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.upsert({
            hhAccountId: t1.accountId as any,
            source: "hh",
            externalId: "resume-ext-1",
            title: "Updated",
            text: "new text"
          })
        })
      )
      expect(r2.id).toBe(r1.id)
      expect(r2.title).toBe("Updated")

      const t2list = await support.runAs(
        t2.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.list()
        })
      )
      expect(t2list.length).toBe(0)

      let failed = false
      try {
        await support.runAs(
          t2.userId,
          Effect.gen(function* () {
            const resumes = yield* ResumeService
            return yield* resumes.get(r1.id)
          })
        )
      } catch {
        failed = true
      }
      expect(failed).toBe(true)

      // enrichment isolation: tenant2 sees no enrichment data
      const t2enr = await support.runAs(
        t2.userId,
        Effect.gen(function* () {
          const resumes = yield* ResumeService
          return yield* resumes.enrichmentGet(r1.id)
        })
      )
      expect(t2enr.comment).toBe("")
      expect(t2enr.salaryMin).toBeUndefined()
    })
  })
}