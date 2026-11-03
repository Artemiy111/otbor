import { describe, expect, test } from "bun:test"
import type { VacancyDraft } from "@otbor/contract"
import {
  finishRunFields,
  progressRunFields,
  searchHitRows,
  startRunFields,
  toCrawlRun,
  type StoredSearchRun
} from "../src/repositories/SearchRepository.ts"
import {
  HYDRATION_MIN_DESCRIPTION,
  mergeStubDescription,
  needsHydration,
  type StoredDescription
} from "../src/repositories/VacancyRepository.ts"

describe("search run bookkeeping", () => {
  test("a new run starts at the requested page with zero counters", () => {
    expect(startRunFields(3)).toEqual({
      status: "running",
      nextPage: 3,
      currentPage: 3,
      pagesTotal: null,
      pagesDone: 0,
      found: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: null
    })
    expect(startRunFields(-5).nextPage).toBe(0)
    expect(startRunFields(2.9).nextPage).toBe(2)
  })

  test("page progress is cumulative and non-negative", () => {
    expect(progressRunFields({ pagesDone: 2, found: 41, nextPage: 2 })).toEqual({
      status: "running",
      pagesDone: 2,
      found: 41,
      nextPage: 2
    })
    expect(progressRunFields({ pagesDone: -1, found: -3, nextPage: -2 })).toEqual({
      status: "running",
      pagesDone: 0,
      found: 0,
      nextPage: 0
    })
    expect(
      progressRunFields({
        pagesDone: 1,
        found: 50,
        nextPage: 1,
        currentPage: 0,
        pagesTotal: 18,
        inserted: 3,
        updated: 2,
        skipped: 45
      })
    ).toEqual({
      status: "running",
      pagesDone: 1,
      found: 50,
      nextPage: 1,
      currentPage: 0,
      pagesTotal: 18,
      inserted: 3,
      updated: 2,
      skipped: 45
    })
  })

  test("finishing records the status, cursor and a timestamp", () => {
    const finishedAt = new Date("2026-11-02T12:00:00.000Z")
    expect(
      finishRunFields(
        { status: "stopped", pagesDone: 4, found: 80, nextPage: 4, error: "captcha" },
        finishedAt
      )
    ).toEqual({
      status: "stopped",
      pagesDone: 4,
      found: 80,
      nextPage: 4,
      error: "captcha",
      finishedAt
    })

    // A successful run keeps next_page as the resume cursor but has no error.
    expect(
      finishRunFields(
        { status: "done", pagesDone: 5, found: 100, nextPage: 5, error: "" },
        finishedAt
      ).error
    ).toBeNull()

    // Ingestion counters are persisted when provided.
    expect(
      finishRunFields(
        {
          status: "done",
          pagesDone: 5,
          found: 100,
          nextPage: 5,
          inserted: 40,
          updated: 10,
          skipped: 10
        },
        finishedAt
      )
    ).toMatchObject({ inserted: 40, updated: 10, skipped: 10 })
  })

  test("hits dedupe cards and keep their page position", () => {
    expect(searchHitRows("query-1", ["v1", "v2", "v1"])).toEqual([
      { queryId: "query-1", vacancyId: "v1", position: 0 },
      { queryId: "query-1", vacancyId: "v2", position: 1 }
    ])
    expect(searchHitRows("query-1", [])).toEqual([])
  })

  test("a stored run maps to the wire record", () => {
    const row: StoredSearchRun = {
      id: "0190f0aa-0000-7000-8000-000000000001",
      queryId: "0190f0aa-0000-7000-8000-000000000002",
      normalizedUrl: "https://hh.ru/search/vacancy?text=devops",
      status: "running",
      nextPage: null,
      currentPage: null,
      pagesTotal: null,
      pagesDone: 0,
      found: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: null,
      startedAt: new Date("2026-11-02T10:00:00.000Z"),
      finishedAt: null
    }

    expect(toCrawlRun(row)).toMatchObject({
      runId: row.id,
      queryId: row.queryId,
      normalizedUrl: row.normalizedUrl,
      status: "running",
      nextPage: 0,
      startedAt: "2026-11-02T10:00:00.000Z",
      finishedAt: null
    })
  })
})

describe("hydrate selection", () => {
  test("a card with no HTML or only a short snippet needs hydration", () => {
    expect(needsHydration({ descriptionHtml: null, descriptionText: null })).toBe(true)
    expect(needsHydration({ descriptionHtml: null, descriptionText: "short" })).toBe(true)
    expect(needsHydration({ descriptionHtml: undefined, descriptionText: undefined })).toBe(true)
    expect(
      needsHydration({ descriptionHtml: "<p>x</p>", descriptionText: "x".repeat(10) })
    ).toBe(true)
  })

  test("a full description is left alone", () => {
    expect(
      needsHydration({
        descriptionHtml: "<p>full</p>",
        descriptionText: "x".repeat(HYDRATION_MIN_DESCRIPTION)
      })
    ).toBe(false)
  })

  test("the minimum length is configurable", () => {
    const description = { descriptionHtml: "<p>x</p>", descriptionText: "x".repeat(50) }
    expect(needsHydration(description, 100)).toBe(true)
    expect(needsHydration(description, 10)).toBe(false)
  })

  test("a later search card does not erase a hydrated description", () => {
    const stub: VacancyDraft = {
      source: "hh",
      externalId: "1",
      canonicalUrl: "https://hh.ru/vacancy/1",
      title: "DevOps",
      descriptionHtml: null,
      descriptionText: "short snippet",
      skills: []
    }
    const stored: StoredDescription = {
      descriptionText: "x".repeat(HYDRATION_MIN_DESCRIPTION),
      descriptionHtml: "<p>full</p>",
      skills: ["Kubernetes"]
    }

    const merged = mergeStubDescription(stub, stored)
    expect(merged.descriptionText).toBe(stored.descriptionText)
    expect(merged.descriptionHtml).toBe(stored.descriptionHtml)
    expect(merged.skills).toEqual(["Kubernetes"])
    expect(merged.title).toBe("DevOps")

    // A fresh card and a full incoming page keep their own description.
    expect(mergeStubDescription(stub, null)).toEqual(stub)
    const full: VacancyDraft = {
      ...stub,
      descriptionHtml: "<p>new</p>",
      descriptionText: "y".repeat(HYDRATION_MIN_DESCRIPTION)
    }
    expect(mergeStubDescription(full, stored)).toEqual(full)
  })
})
