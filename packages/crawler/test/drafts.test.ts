import { describe, expect, test } from "bun:test"
import { draftFromCard } from "../src/drafts.ts"
import { parseSearchHtml } from "../src/search.ts"

const card = {
  externalId: "123456",
  title: "Senior DevOps Engineer",
  url: "https://hh.ru/vacancy/123456",
  companyExternalId: "42",
  companyName: "Acme",
  salaryFrom: 200000,
  salaryTo: 300000,
  salaryCurrency: "RUB",
  salaryGross: true,
  salaryNegotiable: false,
  areaId: 1,
  areaName: "Москва",
  publishedAt: "2026-10-30T10:00:00+03:00",
  snippet: "Удалённая работа, Kubernetes",
  experienceCode: "between3And6",
  employmentForm: "full",
  workFormats: ["REMOTE"],
  workScheduleDays: [],
  workingHours: [],
  archived: false
} as const

describe("search card to draft", () => {
  test("keeps company, salary and work format", () => {
    const draft = draftFromCard(card)
    expect(draft.source).toBe("hh")
    expect(draft.externalId).toBe("123456")
    expect(draft.canonicalUrl).toBe("https://hh.ru/vacancy/123456")
    expect(draft.employer).toEqual({ externalId: "42", name: "Acme" })
    expect(draft.salary).toEqual({
      from: 200000,
      to: 300000,
      currency: "RUB",
      gross: true,
      negotiable: false
    })
    expect(draft.workFormats).toContain("remote")
    expect(draft.seniority).toBe("senior")
    expect(draft.descriptionText).toBe("Удалённая работа, Kubernetes")
  })

  test("keeps a stub without company as nullable employer", () => {
    const stub = parseSearchHtml(
      `<template id="HH-Lux-InitialState">${JSON.stringify({
        vacancySearchResult: {
          vacancies: [{ vacancyId: "7", name: "DevOps", links: { desktop: "https://hh.ru/vacancy/7" } }],
          totalResults: 1
        }
      })}</template>`
    ).cards[0]!
    const draft = draftFromCard(stub)
    expect(draft.employer).toBeNull()
    expect(draft.salary).toBeNull()
  })
})
