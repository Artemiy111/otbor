import { describe, expect, test } from "bun:test"
import { classifyResponsePage, evidenceHtml, MAX_ARTIFACT_HTML, readResponseStatus } from "../src/index.ts"

// Страница hh начинается с сотен КБ встроенных шрифтов и скриптов; признаки
// отклика идут после них.
const heavyHead = `<html><head><style>@font-face{src:url("data:font/woff2;base64,${"A".repeat(600_000)}")}</style>` +
  `<script>window.__state=${JSON.stringify({ blob: "B".repeat(300_000) })}</script></head><body>`

describe("evidenceHtml", () => {
  test("keeps the respond control of a vacancy page that is larger than the cap", () => {
    const page = `${heavyHead}<h1 data-qa="vacancy-title">DevOps</h1>` +
      `<a data-qa="vacancy-response-link-top">Откликнуться</a></body></html>`
    const url = "https://hh.ru/vacancy/123"
    expect(readResponseStatus(page.slice(0, MAX_ARTIFACT_HTML), "123", url).state).toBe("unreadable")
    const evidence = evidenceHtml(page)
    expect(evidence.length).toBeLessThan(MAX_ARTIFACT_HTML)
    expect(readResponseStatus(evidence, "123", url).state).toBe("not_responded")
  })

  test("keeps the responded marker of the page after the click", () => {
    const page = `${heavyHead}<div data-qa="vacancy-response-link-view-topic">Вы откликнулись</div></body></html>`
    const url = "https://hh.ru/vacancy/123"
    expect(readResponseStatus(evidenceHtml(page), "123", url).state).toBe("responded")
    expect(classifyResponsePage(evidenceHtml(page), url)).toBe(classifyResponsePage(page, url))
  })
})
