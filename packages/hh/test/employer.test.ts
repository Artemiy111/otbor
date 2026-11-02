import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { extractEmployer } from "../src/employer.ts"

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
