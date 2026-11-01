import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { extractVacancy } from "../src/extract.ts"
import { decodeEntities, htmlToText } from "../src/text.ts"
import { detectWorkFormats, mapWorkFormat, resolveWorkFormats } from "../src/signals.ts"

const rawVacancy = {
  vacancyView: {
    vacancyFull: {
      vacancy: {
        vacancyId: 12345,
        name: "Senior DevOps Engineer",
        description: "<p>Удалёнка. Kubernetes, Terraform, CI/CD.</p>",
        keySkills: ["Kubernetes", "Terraform", "Kubernetes"],
        compensation: { from: 300000, to: 400000, currency: "RUB", gross: true },
        area: { id: 1, name: "Москва" },
        company: {
          id: 777,
          visibleName: "Acme",
          companySiteUrl: "https://acme.dev",
          logos: [{ type: "vacancyPage", url: "/logo.png" }],
          industries: [{ id: 7, trl: "IT" }]
        },
        workExperience: "between3And6",
        employmentForm: "FULL",
        workFormats: ["REMOTE"],
        publicationTimeIso: "2026-10-31T12:00:00+03:00",
        status: { archived: false }
      },
      extraVacancyFields: {
        totalResponsesCount: 42,
        vacancyResponsesCount: 7
      }
    }
  }
}

const page = (payload: unknown): string =>
  `<html><body><template id="HH-Lux-InitialState">${JSON.stringify(payload)}</template></body></html>`

const errorOf = (html: string) =>
  Effect.runPromise(extractVacancy(html, { url: "https://hh.ru/vacancy/12345?query=1" }).pipe(Effect.flip))

describe("extractVacancy", () => {
  test("normalizes a full vacancy page", async () => {
    const draft = await Effect.runPromise(
      extractVacancy(page(rawVacancy), { url: "https://hh.ru/vacancy/12345?query=1" })
    )

    expect(draft.externalId).toBe("12345")
    expect(draft.canonicalUrl).toBe("https://hh.ru/vacancy/12345")
    expect(draft.title).toBe("Senior DevOps Engineer")
    expect(draft.employer?.name).toBe("Acme")
    expect(draft.employer?.logoUrl).toBe("https://hh.ru/logo.png")
    expect(draft.employer?.industries).toEqual(["IT"])
    expect(draft.salary).toEqual({
      from: 300000,
      to: 400000,
      currency: "RUB",
      gross: true,
      negotiable: false
    })
    expect(draft.areaName).toBe("Москва")
    expect(draft.workFormats).toEqual(["remote"])
    expect(draft.seniority).toBe("senior")
    expect(draft.skills).toEqual(["Kubernetes", "Terraform"])
    expect(draft.responsesTotal).toBe(42)
    expect(draft.responsesVacancy).toBe(7)
    expect(draft.archived).toBe(false)
    expect(draft.descriptionText).toContain("Kubernetes, Terraform")
  })

  test("parses the entity-escaped payload served to anonymous users", async () => {
    const escaped = JSON.stringify(rawVacancy).replace(/"/g, "&#34;")
    const html = `<template id="HH-Lux-InitialState">${escaped}</template>`
    const draft = await Effect.runPromise(
      extractVacancy(html, { url: "https://hh.ru/vacancy/12345" })
    )
    expect(draft.title).toBe("Senior DevOps Engineer")
  })

  test("reports a page that is not hh", async () => {
    const error = await errorOf("<html><body>hello</body></html>")
    expect(error.code).toBe("page_kind_unknown")
  })

  test("reports a missing initial state on an hh page", async () => {
    const error = await errorOf('<div class="vacancy-description">x</div>')
    expect(error.code).toBe("initial_state_missing")
  })

  test("reports invalid JSON", async () => {
    const error = await errorOf('<template id="HH-Lux-InitialState">{bad</template>')
    expect(error.code).toBe("initial_state_invalid")
  })

  test("reports a payload without a vacancy", async () => {
    const error = await errorOf(page({ vacancyView: {} }))
    expect(error.code).toBe("vacancy_missing")
  })

  test("keeps archived and negotiable salary", async () => {
    const draft = await Effect.runPromise(
      extractVacancy(
        page({
          vacancyView: {
            vacancyFull: {
              vacancy: {
                vacancyId: 1,
                name: "DevOps",
                compensation: { noCompensation: true },
                status: { disabled: true }
              }
            }
          }
        }),
        { url: "https://hh.ru/vacancy/1" }
      )
    )
    expect(draft.salary?.negotiable).toBe(true)
    expect(draft.archived).toBe(true)
  })
})

describe("work format signals", () => {
  test("maps hh values", () => {
    expect(mapWorkFormat("REMOTE")).toBe("remote")
    expect(mapWorkFormat("HYBRID")).toBe("hybrid")
    expect(mapWorkFormat("ONSITE")).toBe("office")
    expect(mapWorkFormat("TRAVEL_TIME")).toBe("unknown")
  })

  test("structured formats win over text", () => {
    expect(resolveWorkFormats(["REMOTE"], "только офис")).toEqual(["remote"])
  })

  test("falls back to the body when structured formats are empty", () => {
    expect(resolveWorkFormats([], "Гибрид: 3 дня в офисе, 2 дома.")).toEqual([
      "hybrid",
      "office"
    ])
  })

  test("explicit negation removes a format", () => {
    expect(detectWorkFormats("Удалёнки нет, работа в офисе.")).toEqual(["office"])
    expect(detectWorkFormats("Работа удалённо, офиса нет.")).toEqual(["remote"])
  })
})

describe("text helpers", () => {
  test("decodes entities and strips tags", () => {
    expect(decodeEntities("&lt;p&gt;Привет&lt;/p&gt;")).toBe("<p>Привет</p>")
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>one</li></ul>")).toBe(
      "Hello world\n\n• one"
    )
  })
})
