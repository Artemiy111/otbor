import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { extractEmployer, parseEmployerReviewsWidget } from "../src/employer.ts"

const page = (payload: unknown): string =>
  `<html><body><template id="HH-Lux-InitialState">${JSON.stringify(payload)}</template></body></html>`

describe("extractEmployer", () => {
  test("reads the employer node out of the initial state", async () => {
    const draft = await Effect.runPromise(
      extractEmployer(
        page({
          employerView: {
            employer: {
              id: 777,
              visibleName: "Acme",
              companySiteUrl: "https://acme.dev",
              logos: [{ url: "/logo.png" }],
              industries: [{ trl: "IT" }, { name: "Finance" }],
              employerRating: 4.6,
              reviewsCount: 128,
              recommendationsPercent: 91
            }
          }
        }),
        { externalId: "777" }
      )
    )

    expect(draft).toMatchObject({
      externalId: "777",
      name: "Acme",
      rating: 4.6,
      reviewsCount: 128,
      recommendationsPercent: 91,
      siteUrl: "https://acme.dev",
      logoUrl: "https://hh.ru/logo.png",
      industries: ["IT", "Finance"]
    })
  })

  test("reads the full profile from the real employerInfo shape", async () => {
    const draft = await Effect.runPromise(
      extractEmployer(
        page({
          employerInfo: {
            id: 1455,
            name: "HeadHunter",
            category: "company",
            sizeCategory: null,
            address: "Россия",
            site: { hostname: "hh.ru", href: "https://hh.ru/" },
            industries: [{ id: 7, trl: "Информационные технологии", items: [541] }],
            hrBrand: null,
            badges: [{ type: "TOP", description: "Лучший", year: 2025 }],
            description: "&lt;p&gt;Компания &lt;strong&gt;HeadHunter&lt;/strong&gt; &amp;amp; друзья&lt;/p&gt;",
            accreditedITEmployer: true,
                  accepted: true,
            isTrusted: true,
            isIdentifiedByEsia: false,
                        employerCountryCode: "RU"
          },
          employerOrganizationSchema: {
            name: "HeadHunter",
            logoUrl: "/employer-logo/1.png",
            siteUrl: "https://hh.ru/",
            aggregateRating: { ratingValue: "4.5", ratingCount: 255 }
          },
          activeEmployerVacancyCount: 40,
          employerHeaderPictureWebPath: "/branding-pictures/1.jpeg"
        }),
        { externalId: "1455" }
      )
    )

    expect(draft).toMatchObject({
      externalId: "1455",
      name: "HeadHunter",
      rating: 4.5,
      reviewsCount: 255,
      siteUrl: "https://hh.ru/",
      siteHost: "hh.ru",
      logoUrl: "https://hh.ru/employer-logo/1.png",
      industries: ["Информационные технологии"],
      category: "company",
      address: "Россия",
      trusted: true,
      accreditedIt: true,
      activeVacancies: 40,
      descriptionText: "Компания HeadHunter & друзья",
      badges: [{ type: "TOP", description: "Лучший", url: null, year: 2025 }]
    })
  })

  test("falls back to JSON-LD when the initial state is absent", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "Organization",
      name: "Beta LLC",
      url: "https://beta.example",
      logo: "https://beta.example/logo.png",
      aggregateRating: { ratingValue: 4.1, reviewCount: 22 }
    })}</script></head><body></body></html>`

    const draft = await Effect.runPromise(
      extractEmployer(html, { externalId: "42" })
    )

    expect(draft).toMatchObject({
      externalId: "42",
      name: "Beta LLC",
      rating: 4.1,
      reviewsCount: 22,
      siteUrl: "https://beta.example",
      logoUrl: "https://beta.example/logo.png"
    })
  })

  test("a page without profile fields is a parse error", async () => {
    const error = await Effect.runPromise(
      extractEmployer("<html><body>no data here</body></html>", { externalId: "9" }).pipe(
        Effect.flip
      )
    )
    expect(error._tag).toBe("HhParseError")
    expect(error.code).toBe("employer_missing")
  })
})

describe("parseEmployerReviewsWidget", () => {
  test("reads the JSON widget", () => {
    expect(
      parseEmployerReviewsWidget(
        JSON.stringify({ employerReviews: { totalRating: "4.3", reviewsCount: 120, recommendationsPercent: 87 } })
      )
    ).toEqual({ rating: 4.3, reviewsCount: 120, recommendationsPercent: 87 })
  })

  test("reads the HTML shell state", () => {
    const state = JSON.stringify({ employerReviews: { totalRating: 3.9, reviewsCount: 5 } }).replace(/"/g, "&quot;")
    const html = `<template class="x EmployerReviewsFront-InitialState">${state}</template>`
    expect(parseEmployerReviewsWidget(html)).toEqual({ rating: 3.9, reviewsCount: 5, recommendationsPercent: null })
  })

  test("decodes numeric entities such as the escaped backslash", () => {
    const state = JSON.stringify({ employerReviews: { totalRating: "4.4", reviewsCount: 7, recommendationsPercent: 83, note: 'a "b"' } })
      .replace(/\\/g, "&#92;")
      .replace(/"/g, "&quot;")
    const html = `<template style="display: none" class="EmployerReviewsFront-InitialState">${state}</template>`
    expect(parseEmployerReviewsWidget(html)).toEqual({ rating: 4.4, reviewsCount: 7, recommendationsPercent: 83 })
  })

  test("returns null for unknown bodies", () => {
    expect(parseEmployerReviewsWidget("<html></html>")).toBeNull()
  })
})

test("reads aggregateRating from the state", async () => {
  const draft = await Effect.runPromise(
    extractEmployer(page({ organization: { id: 9, companySiteUrl: "https://a.ru", aggregateRating: { ratingValue: "4.1", ratingCount: 33 } } }), { externalId: "9" })
  )
  expect(draft.rating).toBe(4.1)
  expect(draft.reviewsCount).toBe(33)
})
