import { describe, expect, test } from "bun:test"
import { parseResumePage, parseResumeRefs, resumeExperienceKey, resumeStateFragment } from "../src/index.ts"

/** Synthetic, hand-written shapes; not yet checked against a live logged-in page. */
const HASH = "0123456789abcdef0123456789abcdef01234567"

const resumeHtml = (overrides: Record<string, unknown> = {}) =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({
    hhid: 42,
    applicantResume: {
      _attributes: { hash: HASH, id: 555, status: "published", updated: 1_700_000_000_000 },
      title: [{ string: "DevOps Engineer" }],
      skills: [{ string: "Строю <b>платформы</b> &amp; CI" }],
      keySkills: [{ string: "Kubernetes" }, { string: "kubernetes" }, { string: "Terraform" }],
      advancedKeySkills: [{ name: "Linux" }],
      workFormats: [{ string: "remote" }],
      salary: [{ amount: 300000, currency: "RUR" }],
      experience: [
        {
          companyName: "Acme",
          position: "SRE",
          startDate: "2020-01-01",
          endDate: null,
          description: "<p>Вёл миграцию</p>"
        }
      ],
      primaryEducation: [{ name: "МГУ", organization: "ВМК", year: 2015 }],
      ...overrides
    }
  })}</template>`

describe("parseResumePage", () => {
  test("reads the resume with every block that reaches the model", () => {
    const resume = parseResumePage(resumeHtml())
    expect(resume).not.toBeNull()
    expect(resume!.externalId).toBe("555")
    expect(resume!.hash).toBe(HASH)
    expect(resume!.title).toBe("DevOps Engineer")
    expect(resume!.about).toBe("Строю платформы & CI")
    expect(resume!.skills).toEqual(["Linux", "Kubernetes", "Terraform"])
    expect(resume!.workFormats).toEqual(["REMOTE"])
    expect(resume!.salaryAmount).toBe(300000)
    expect(resume!.status).toBe("published")
    expect(resume!.experience[0]?.description).toBe("Вёл миграцию")
    expect(resume!.text).toContain("Опыт работы:\nSRE — Acme")
    expect(resume!.text).toContain("Образование:\nМГУ · ВМК · 2015")
    expect(resume!.updatedAt).toBe("2023-11-14T22:13:20.000Z")
  })

  test("reads the English level from the language block as hh sends it", () => {
    const level = (language: unknown) => parseResumePage(resumeHtml({ language }))?.englishLevel
    // Shape taken from a live resume page: language ids, no names; 34 is Russian, 57 English.
    expect(level([{ degree: "l1", id: 34 }, { degree: "b2", id: 57 }, { degree: "b1", id: 16 }])).toBe("B2")
    expect(level([{ degree: "l1", id: 57 }])).toBe("родной")
    expect(level([{ degree: "l1", id: 34 }, { degree: "b1", id: 16 }])).toBeNull()
    expect(level(undefined)).toBeNull()
  })

  test("a page without a resume is unreadable, not empty", () => {
    expect(parseResumePage("<html>oops</html>")).toBeNull()
    expect(
      parseResumePage('<template id="HH-Lux-InitialState">{"applicantResume":{}}</template>')
    ).toBeNull()
  })

  test("the evidence fragment keeps the resume readable", () => {
    const fragment = resumeStateFragment(resumeHtml())
    expect(fragment).not.toBeNull()
    expect(parseResumePage(fragment!)?.title).toBe("DevOps Engineer")
  })
})

describe("parseResumeRefs", () => {
  test("finds the cards once each", () => {
    const html = `
      <div data-qa="resume" data-qa-id="1" data-qa-title="DevOps &amp; SRE">
        <a data-qa="resume-card-link-${HASH}" href="/resume/${HASH}?hhtmFrom=profile">x</a>
        <a href="/resume/${HASH}">again</a>
      </div>`
    expect(parseResumeRefs(html)).toEqual([{ hash: HASH, title: "DevOps & SRE" }])
    expect(parseResumeRefs("<html></html>")).toEqual([])
  })
})

test("experience key is stable under case and spacing", () => {
  expect(resumeExperienceKey({ companyName: " Acme ", position: "SRE", startDate: null })).toBe("acme|sre|")
})
