import { describe, expect, test } from "bun:test"
import {
  classifyCrawlBlock,
  normalizeSearchUrl,
  parseSearchHtml,
  withPageParam
} from "../src/search.ts"

const state = {
  vacancySearchResult: {
    vacancies: [
      {
        vacancyId: "123456",
        name: "Senior DevOps Engineer",
        company: { id: 42, visibleName: "Acme" },
        compensation: {
          from: 200000,
          to: 300000,
          currencyCode: "RUB",
          gross: true
        },
        area: { id: 1, name: "Москва" },
        publicationTime: { $: "2026-10-30T10:00:00+03:00" },
        links: { desktop: "https://hh.ru/vacancy/123456?from=search" },
        snippet: {
          requirement: "Kubernetes и Terraform",
          responsibility: "Поддерживать платформу"
        },
        workExperience: "between3And6",
        employmentForm: "full",
        workFormats: ["REMOTE"],
        closedForApplicants: false
      },
      {
        // Duplicate within one page: must be collapsed by external id.
        vacancyId: "123456",
        name: "Senior DevOps Engineer (duplicate)",
        links: { desktop: "https://hh.ru/vacancy/123456" }
      }
    ],
    totalResults: 21,
    criteria: {
      page: 0,
      items_on_page: 20,
      text: "devops",
      area: [1],
      order_by: "relevance",
      search_field: ["name"]
    },
    paging: {
      lastPage: { page: 1 },
      next: { page: 1 }
    }
  }
}

const html = `<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`

describe("search page parser", () => {
  test("reads cards, paging and criteria from HH-Lux-InitialState", () => {
    const page = parseSearchHtml(html)
    expect(page.page).toBe(0)
    expect(page.totalResults).toBe(21)
    expect(page.pagesTotal).toBe(2)
    expect(page.hasNext).toBe(true)
    expect(page.cards).toHaveLength(1)

    const card = page.cards[0]!
    expect(card.externalId).toBe("123456")
    expect(card.title).toBe("Senior DevOps Engineer")
    expect(card.companyExternalId).toBe("42")
    expect(card.companyName).toBe("Acme")
    expect(card.salaryFrom).toBe(200000)
    expect(card.salaryTo).toBe(300000)
    expect(card.salaryCurrency).toBe("RUB")
    expect(card.salaryGross).toBe(true)
    expect(card.areaId).toBe(1)
    expect(card.areaName).toBe("Москва")
    expect(card.snippet).toBe("Kubernetes и Terraform\nПоддерживать платформу")
    expect(card.workFormats).toEqual(["REMOTE"])
  })

  test("classifies a captcha page and a legal block", () => {
    expect(classifyCrawlBlock(200, "<title>Подтвердите, что вы не робот</title>")).toBe("captcha")
    expect(classifyCrawlBlock(451, "")).toBe("geo")
    expect(classifyCrawlBlock(403, "")).toBe("forbidden")
    expect(classifyCrawlBlock(200, html)).toBeNull()
  })

  test("normalizes a saved search and sets a page", () => {
    const normalized = normalizeSearchUrl(
      "https://hh.ru/search/vacancy?text=devops&area=1&page=3&hhtmFrom=main&search_session_id=abc"
    )
    expect(normalized).toBe("https://hh.ru/search/vacancy?area=1&text=devops")
    expect(withPageParam(normalized, 2)).toBe(
      "https://hh.ru/search/vacancy?area=1&text=devops&page=2"
    )
  })
})
