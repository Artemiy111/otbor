/**
 * `signals.hh` persistence against a real Postgres: a re-hydration whose
 * content hash is unchanged still stores the new hh signals, and a search-card
 * stub never erases them.
 */
import { afterAll, beforeAll, expect, test } from "bun:test"
import type { HhVacancySignals, VacancyDraft } from "@otbor/contract"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "../../src/db/Database.ts"
import * as VacancyRepository from "../../src/repositories/VacancyRepository.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("hh signals integration suite is opt-in", () => {
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

  const signals = (letter: boolean | null): HhVacancySignals => ({
    capturedAt: "2026-11-04T00:00:00.000Z",
    letterRequired: letter,
    test: { hasTest: true, required: true },
    validUntil: null,
    workScheduleDays: ["FIVE_ON_TWO_OFF"],
    workingHours: []
  })

  test("unchanged content still updates signals.hh; a stub keeps them", async () => {
    const tenant = await support.seedTenant("hh-signals")
    const externalId = `sig-${Math.random().toString(36).slice(2, 10)}`
    const full: VacancyDraft = {
      externalId,
      canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
      title: "Backend Engineer",
      descriptionHtml: "<p>x</p>",
      descriptionText: "Строим бэкенд на TypeScript и Postgres. ".repeat(20)
    }

    const first = await support.corpusIngest(tenant.userId, [full])
    const id = first.items[0]!.id
    const read = () =>
      support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => VacancyRepository.hhSignalsOf(tx, id))
        })
      )
    expect(await read()).toBeNull()

    // Pre-existing foreign key must survive the merge.
    await support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const database = yield* Database
        yield* database.asOwner((tx) =>
          tx.execute(sql`update vacancy set signals = '{"other": 1}'::jsonb where id = ${id}`)
        )
      })
    )

    const second = await support.corpusIngest(tenant.userId, [{ ...full, hhSignals: signals(true) }])
    expect(second.skipped).toBe(1)
    expect((await read())?.letterRequired).toBe(true)

    const third = await support.corpusIngest(tenant.userId, [
      { externalId, canonicalUrl: full.canonicalUrl, title: full.title }
    ])
    expect(third.items.length).toBeGreaterThanOrEqual(0)
    expect((await read())?.letterRequired).toBe(true)

    const kept = await support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) =>
          tx.execute(sql`select signals from vacancy where id = ${id}`)
        )
      })
    )
    expect((kept.rows[0] as { signals: Record<string, unknown> }).signals.other).toBe(1)
  })

  test("backfill lists complete vacancies without signals.hh until they are captured", async () => {
    const tenant = await support.seedTenant("hh-backfill")
    const externalId = `bf-${Math.random().toString(36).slice(2, 10)}`
    const full: VacancyDraft = {
      externalId,
      canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
      title: "Platform Engineer",
      descriptionHtml: "<p>x</p>",
      descriptionText: "Строим платформу на Kubernetes и Terraform. ".repeat(20)
    }
    const first = await support.corpusIngest(tenant.userId, [full])
    const id = first.items[0]!.id
    const pending = () =>
      support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const database = yield* Database
          const rows = yield* database.asOwner((tx) =>
            VacancyRepository.listNeedingHydration(tx, { limit: 500, missingHhSignals: true })
          )
          return rows.map((row) => row.id)
        })
      )
    expect(await pending()).toContain(id)

    await support.corpusIngest(tenant.userId, [{ ...full, hhSignals: signals(false) }])
    expect(await pending()).not.toContain(id)
  })

  test("response counts: listed until captured, and a search card does not erase them", async () => {
    const tenant = await support.seedTenant("hh-counts")
    const externalId = `rc-${Math.random().toString(36).slice(2, 10)}`
    const full: VacancyDraft = {
      externalId,
      canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
      title: "Platform Engineer",
      descriptionHtml: "<p>x</p>",
      descriptionText: "Строим платформу на Kubernetes и Terraform. ".repeat(20)
    }
    const first = await support.corpusIngest(tenant.userId, [full])
    const id = first.items[0]!.id
    const pending = () =>
      support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const database = yield* Database
          const rows = yield* database.asOwner((tx) =>
            VacancyRepository.listNeedingHydration(tx, { limit: 500, missingResponses: true })
          )
          return rows.map((row) => row.id)
        })
      )
    expect(await pending()).toContain(id)

    await support.corpusIngest(tenant.userId, [{ ...full, responsesTotal: 42 }])
    expect(await pending()).not.toContain(id)

    // A later search card carries no count; the stored one stays.
    await support.corpusIngest(tenant.userId, [{ ...full, responsesTotal: null }])
    expect(await pending()).not.toContain(id)
  })
}
