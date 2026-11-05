/**
 * Hydration queue hardening against a real Postgres: blocked hh responses stop
 * the pass instead of poisoning the whole queue, failures back off so one bad
 * target cannot starve the rest, and a page that belongs to another vacancy or
 * company is rejected before it is written to the corpus.
 *
 * Pages come from fixtures, never from hh.ru.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "../../src/db/Database.ts"
import { EmployerHydrator } from "../../src/services/EmployerHydrator.ts"
import { HydrationRunner } from "../../src/services/HydrationRunner.ts"
import { PageFetch } from "../../src/services/pageFetch.ts"
import { ProxyRotator } from "../../src/services/proxyRotator.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const vacancyPage = (externalId: string, title: string): string =>
  `<html><body><template id="HH-Lux-InitialState">${
    JSON.stringify({
      vacancyView: {
        vacancyFull: {
          extraVacancyFields: { totalResponsesCount: 5 },
          vacancy: {
            vacancyId: Number(externalId),
            name: title,
            description: `<p>${"Строим бэкенд на TypeScript и Postgres. ".repeat(20)}</p>`,
            keySkills: ["TypeScript"],
            area: { id: 1, name: "Москва" },
            company: { id: 4242, visibleName: "Hydration Co" },
            workExperience: "between3And6",
            employmentForm: "FULL",
            workFormats: ["REMOTE"],
            publicationTimeIso: "2026-10-31T12:00:00+03:00",
            status: { archived: false }
          }
        }
      }
    })
  }</template></body></html>`

const employerPage = (externalId: string, name: string): string =>
  `<html><body><template id="HH-Lux-InitialState">${
    JSON.stringify({
      employerView: {
        employer: {
          id: Number(externalId),
          visibleName: name,
          companySiteUrl: "https://example.test",
          employerRating: 4.4,
          reviewsCount: 120,
          industries: [{ id: 1, trl: "IT" }],
          logos: [{ url: "https://img.example.test/logo.png" }]
        }
      }
    })
  }</template></body></html>`

const captcha = "<html><body>Подтвердите, что вы не робот</body></html>"

if (!enabled || serverUrl === null) {
  test("hydration hardening integration suite is opt-in", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await support.createTestDatabase(base)
    await support.migrateTestDatabase(base)
    process.env.DATABASE_URL = support.testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await support.dropTestDatabase(base)
  }, 60_000)

  const runHydration = (
    fetchPage: (url: string, proxy: string | null) => Promise<{ status: number; url: string; html: string }>,
    options: { limit?: number; delayMs?: number } = {}
  ) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const runner = yield* HydrationRunner
        return yield* runner.run("owner", { limit: 25, delayMs: 0, proxyMode: "direct", ...options })
      }).pipe(Effect.provideService(PageFetch, fetchPage))
    )

  const hydrateOne = (
    id: string,
    fetchPage: (url: string, proxy: string | null) => Promise<{ status: number; url: string; html: string }>
  ) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const runner = yield* HydrationRunner
        return yield* runner.hydrateOne("owner", id, "direct")
      }).pipe(Effect.provideService(PageFetch, fetchPage))
    )

  const hydrateEmployerOne = (
    id: string,
    fetchPage: (url: string, proxy: string | null) => Promise<{ status: number; url: string; html: string }>
  ) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const hydrator = yield* EmployerHydrator
        return yield* hydrator.hydrateOne("owner", id, "direct")
      }).pipe(Effect.provideService(PageFetch, fetchPage))
    )

  const runEmployers = (
    fetchPage: (url: string, proxy: string | null) => Promise<{ status: number; url: string; html: string }>,
    options: { limit?: number; delayMs?: number } = {}
  ) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const hydrator = yield* EmployerHydrator
        return yield* hydrator.run("owner", { limit: 25, delayMs: 0, proxyMode: "direct", ...options })
      }).pipe(Effect.provideService(PageFetch, fetchPage))
    )

  const attempts = async (kind: "vacancy" | "employer") => {
    const result = await support
      .runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            tx.execute(sql`
              select target_id, external_id, attempts, last_status, last_error,
                     next_retry_at > now() as deferred
              from hydration_attempt
              where target_kind = ${kind}
              order by external_id
            `)
          )
        })
      )
    return result.rows as ReadonlyArray<{
      target_id: string
      external_id: string
      attempts: number
      last_status: string
      last_error: string | null
      deferred: boolean
    }>
  }

  describe("blocked hh responses", () => {
    test("a captcha stops the vacancy pass and defers only the attempted target", async () => {
      const first = await support.seedVacancyTitled("block-a", "Backend developer block-a")
      const second = await support.seedVacancyTitled("block-b", "Backend developer block-b")

      const result = await runHydration(() =>
        Promise.resolve({ status: 200, url: "https://hh.ru/search/vacancy", html: captcha })
      )

      expect(result.hydrated).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.processed).toBe(1)
      expect(result.stoppedBy).toBe("captcha")
      expect(result.errors.join(" ")).toContain("капчей")

      const rows = (await attempts("vacancy")).filter((row) => row.target_id === first || row.target_id === second)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.deferred).toBe(true)
      expect(rows[0]?.last_status).toBe("failed")
    })

    test("a 403 on one vacancy is retried at the end of the queue and does not stop the pass", async () => {
      const dead = await support.seedVacancyWithExternal("920001", "Dead vacancy")
      const alive = await support.seedVacancyWithExternal("920002", "Alive vacancy")

      const seen: string[] = []
      const result = await runHydration((url) => {
        const externalId = url.split("/").pop() ?? ""
        seen.push(externalId)
        if (externalId === "920001") return Promise.resolve({ status: 403, url, html: "" })
        return Promise.resolve({ status: 200, url, html: vacancyPage(externalId, "Alive vacancy") })
      })

      expect(result.stoppedBy).toBeNull()
      // Other tests in this database leave stubs behind, so only assert on ours.
      expect(result.hydrated).toBeGreaterThanOrEqual(1)
      expect(seen).toContain("920002")
      expect(seen.filter((id) => id === "920001")).toHaveLength(3)
      expect(seen.lastIndexOf("920002")).toBeLessThan(seen.lastIndexOf("920001"))
      expect(result.errors.join(" ")).toContain("вакансия недоступна")

      const rows = await attempts("vacancy")
      expect(rows.find((row) => row.target_id === dead)?.deferred).toBe(true)
      expect(rows.find((row) => row.target_id === alive)).toBeUndefined()
    })

    test("a 403 on employer pages is retried and does not stop a short pass", async () => {
      await support.seedVacancyForEmployer({
        label: "emp-block-a",
        title: "Backend developer emp-block-a",
        employerExternalId: "700001",
        employerName: "Block Co A"
      })
      await support.seedVacancyForEmployer({
        label: "emp-block-b",
        title: "Backend developer emp-block-b",
        employerExternalId: "700002",
        employerName: "Block Co B"
      })

      const result = await runEmployers(() =>
        Promise.resolve({ status: 403, url: "https://hh.ru/employer/700001", html: "" })
      )

      expect(result.updated).toBe(0)
      expect(result.failed).toBeGreaterThanOrEqual(2)
      expect(result.processed).toBe(result.failed)
      expect(result.stoppedBy).toBeNull()
      expect((await attempts("employer")).length).toBeGreaterThanOrEqual(2)
    })

    test("a captcha with rotation enabled switches the node and retries once", async () => {
      const id = await support.seedVacancyWithExternal("930400", "Rotated vacancy")
      const previous = {
        url: process.env.OTBOR_PROXY_URL,
        controller: process.env.OTBOR_PROXY_CONTROLLER,
        rotate: process.env.OTBOR_PROXY_ROTATE
      }
      process.env.OTBOR_PROXY_URL = "http://127.0.0.1:9"
      process.env.OTBOR_PROXY_CONTROLLER = "http://127.0.0.1:9"
      process.env.OTBOR_PROXY_ROTATE = "captcha"

      let calls = 0
      let rotations = 0
      try {
        const hydrated = await support.runAs(
          "owner",
          Effect.gen(function*() {
            const runner = yield* HydrationRunner
            return yield* runner.hydrateOne("owner", id, "auto")
          }).pipe(
            Effect.provideService(PageFetch, (url: string) => {
              calls += 1
              if (calls === 1) {
                return Promise.resolve({ status: 200, url, html: captcha })
              }
              return Promise.resolve({
                status: 200,
                url,
                html: vacancyPage("930400", "Rotated vacancy")
              })
            }),
            Effect.provideService(ProxyRotator, () => {
              rotations += 1
              return Promise.resolve({ node: "next-node", delay: 5, previous: null })
            })
          )
        )

        expect(hydrated).toBe(true)
        expect(rotations).toBe(1)
        expect(calls).toBe(2)
      } finally {
        if (previous.url === undefined) delete process.env.OTBOR_PROXY_URL
        else process.env.OTBOR_PROXY_URL = previous.url
        if (previous.controller === undefined) delete process.env.OTBOR_PROXY_CONTROLLER
        else process.env.OTBOR_PROXY_CONTROLLER = previous.controller
        if (previous.rotate === undefined) delete process.env.OTBOR_PROXY_ROTATE
        else process.env.OTBOR_PROXY_ROTATE = previous.rotate
      }
    })

    test("a 429 is recorded as a rate limit and stops the pass", async () => {
      await support.seedVacancyTitled("rate-a", "Backend developer rate-a")
      const result = await runHydration(() =>
        Promise.resolve({ status: 429, url: "https://hh.ru/vacancy/1", html: "" })
      )
      expect(result.stoppedBy).toBe("rate_limit")
      expect(result.processed).toBe(1)
    })
  })

  describe("retry debt", () => {
    test("repeated failures grow the delay and a success clears it", async () => {
      const failing = await support.seedVacancyWithExternal("900100", "Failing vacancy")
      const healthy = await support.seedVacancyWithExternal("900101", "Healthy vacancy")

      const broken = () => Promise.resolve({ status: 500, url: "https://hh.ru/vacancy/900100", html: "" })
      expect(await hydrateOne(failing, broken)).toBe(false)
      expect(await hydrateOne(failing, broken)).toBe(false)
      expect(await hydrateOne(failing, broken)).toBe(false)

      const row = (await attempts("vacancy")).find((item) => item.target_id === failing)
      expect(row?.attempts).toBe(3)
      expect(row?.deferred).toBe(true)

      const ok = (url: string) => {
        const externalId = url.split("/").pop() ?? ""
        const title = externalId === "900100" ? "Failing vacancy" : "Healthy vacancy"
        return Promise.resolve({ status: 200, url, html: vacancyPage(externalId, title) })
      }

      // The deferred target is not selected while its retry time is in the future.
      const skipped = await runHydration(ok, { limit: 1 })
      expect(skipped.processed).toBe(1)
      expect(skipped.hydrated).toBe(1)

      expect((await attempts("vacancy")).find((item) => item.target_id === healthy)).toBeUndefined()

      // Simulate the retry window passing; a successful page clears the debt.
      await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          yield* database.asOwner((tx) =>
            tx.execute(sql`update hydration_attempt set next_retry_at = now() - interval '1 second'`)
          )
        })
      )
      expect(await hydrateOne(failing, ok)).toBe(true)
      expect((await attempts("vacancy")).find((item) => item.target_id === failing)).toBeUndefined()
    })
  })

  describe("page identity", () => {
    test("a vacancy page for another vacancy is rejected and not ingested", async () => {
      const id = await support.seedVacancyWithExternal("910200", "Expected vacancy")
      const hydrated = await hydrateOne(id, () =>
        Promise.resolve({
          status: 200,
          url: "https://hh.ru/vacancy/910201",
          html: vacancyPage("910201", "Someone else's vacancy")
        })
      )

      expect(hydrated).toBe(false)

      const stored = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            tx.execute(sql`select external_id from vacancy where external_id = '910201'`)
          )
        })
      )
      expect(stored.rows).toHaveLength(0)

      const row = (await attempts("vacancy")).find((item) => item.target_id === id)
      expect(row?.last_status).toBe("failed")
      expect(row?.last_error ?? "").toContain("910201")
    })

    test("an employer page that redirects to another company is rejected", async () => {
      const seeded = await support.seedVacancyForEmployer({
        label: "emp-wrong",
        title: "Backend developer emp-wrong",
        employerExternalId: "920300",
        employerName: "Right Co"
      })

      const hydrated = await hydrateEmployerOne(seeded.employerId, () =>
        Promise.resolve({
          status: 200,
          url: "https://hh.ru/employer/920301",
          html: employerPage("920301", "Wrong Co")
        })
      )

      expect(hydrated).toBe(false)

      const employerRow = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            tx.execute(sql`select name, rating from employer where id = ${seeded.employerId}`)
          )
        })
      )
      expect(employerRow.rows[0]).toMatchObject({ name: "Right Co", rating: null })
      const row = (await attempts("employer")).find((item) => item.target_id === seeded.employerId)
      expect(row?.last_status).toBe("failed")
      expect(row?.last_error ?? "").toContain("920301")
    })
  })
}
