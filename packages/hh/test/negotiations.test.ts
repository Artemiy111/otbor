import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  initialStateFragment,
  negotiationsStateFragment,
  parseNegotiations,
  readInitialState,
  readResponseStatus
} from "../src/index.ts"

/**
 * The fixtures are SYNTHETIC: written by hand to match the markers the code
 * reads, not captured from hh.ru. They prove the parsers' rules, not that hh
 * still ships these markers.
 */
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8")

const URL_OK = "https://hh.ru/vacancy/100500"

describe("parseNegotiations", () => {
  test("reads the topic list of the initial state", () => {
    const page = parseNegotiations(fixture("synthetic-negotiations.html"))
    expect(page.readable).toBe(true)
    expect(page.topics.map((topic) => topic.vacancyId)).toEqual(["100500", "200600"])
    expect(page.topics[0]).toMatchObject({ state: "RESPONSE", archived: false })
    expect(page.topics[1]).toMatchObject({ state: "DISCARD", discardReason: "no_match", archived: true })
  })

  test("an empty list is readable and empty", () => {
    expect(parseNegotiations(fixture("synthetic-negotiations-empty.html"))).toEqual({
      readable: true,
      topics: [],
      pageCount: null
    })
  })

  test("entity-escaped state is decoded", () => {
    const page = parseNegotiations(fixture("synthetic-negotiations-escaped.html"))
    expect(page.topics.map((topic) => topic.vacancyId)).toEqual(["300700"])
  })

  test("a page without the list is unreadable, never empty", () => {
    expect(parseNegotiations("<html><body>hi</body></html>").readable).toBe(false)
    expect(
      parseNegotiations('<template id="HH-Lux-InitialState">{"other":1}</template>').readable
    ).toBe(false)
    expect(
      parseNegotiations('<template id="HH-Lux-InitialState">not json</template>').readable
    ).toBe(false)
  })

  test("one malformed topic makes the page unreadable", () => {
    const html =
      '<template id="HH-Lux-InitialState">{"applicantNegotiations":{"topicList":[{"vacancyId":1},{"x":2}]}}</template>'
    expect(parseNegotiations(html)).toEqual({ readable: false, topics: [], pageCount: null })
  })
})

describe("parseNegotiations details", () => {
  test("reads status, date, employer, title and the page count", () => {
    const page = parseNegotiations(fixture("synthetic-negotiations-detailed.html"))
    expect(page.readable).toBe(true)
    expect(page.pageCount).toBe(3)
    expect(page.topics[0]).toMatchObject({
      vacancyId: "111",
      state: "INVITATION",
      changedAt: "2026-10-01T07:00:00.000Z",
      employerName: "Acme",
      vacancyName: "Backend Developer"
    })
    expect(page.topics[1]).toMatchObject({
      vacancyId: "222",
      changedAt: new Date(1760000000000).toISOString(),
      employerName: "Globex",
      vacancyName: null
    })
    // An unreadable date is no date, never a guess.
    expect(page.topics[2]).toMatchObject({ vacancyId: "333", changedAt: null, employerName: null })
  })

  test("a list without paging has no page count", () => {
    expect(parseNegotiations(fixture("synthetic-negotiations.html")).pageCount).toBeNull()
  })
})

describe("initial state helpers", () => {
  test("fragment is the template alone", () => {
    const html = fixture("synthetic-negotiations.html")
    const fragment = initialStateFragment(html)
    expect(fragment?.startsWith("<template")).toBe(true)
    expect(fragment).not.toContain("<body>")
    expect(readInitialState(fragment ?? "")).not.toBeNull()
    expect(initialStateFragment("<html></html>")).toBeNull()
  })
})

describe("negotiationsStateFragment", () => {
  const bigPage = () => {
    const state = {
      unrelated: "x".repeat(600_000),
      applicantNegotiations: {
        topicList: [{ vacancyId: 1, lastState: "RESPONSE", lastModified: "2026-11-03T20:04:42.272Z" }],
        pageCount: "5"
      }
    }
    return `<html><template id="HH-Lux-InitialState">${JSON.stringify(state)}</template></html>`
  }

  test("a state larger than the fragment limit still reads as a list", () => {
    const html = bigPage()
    expect(parseNegotiations(initialStateFragment(html) ?? "").readable).toBe(false)
    const page = parseNegotiations(negotiationsStateFragment(html) ?? "")
    expect(page.readable).toBe(true)
    expect(page.topics.map((topic) => topic.vacancyId)).toEqual(["1"])
    expect(page.pageCount).toBe(5)
  })

  test("falls back to the plain fragment without a negotiations state", () => {
    const html = fixture("synthetic-negotiations.html")
    expect(negotiationsStateFragment(html)).not.toBeNull()
    expect(negotiationsStateFragment("<html></html>")).toBeNull()
  })
})

describe("readResponseStatus", () => {
  test("the view-response control means responded", () => {
    const status = readResponseStatus(fixture("synthetic-vacancy-responded.html"), "100500", URL_OK)
    expect(status.state).toBe("responded")
    expect(status.markers).toContain("vacancy-response-link-view-topic")
  })

  test("the plain respond control on the vacancy means not responded", () => {
    expect(readResponseStatus(fixture("synthetic-vacancy-open.html"), "100500", URL_OK).state).toBe(
      "not_responded"
    )
  })

  test("a marker only inside a script is ignored", () => {
    const html =
      '<h1 data-qa="vacancy-title">x</h1><script>"data-qa=\\"vacancy-response-link-view-topic\\""</script>'
    expect(readResponseStatus(html, "100500", URL_OK).state).toBe("unreadable")
  })

  test("another url, an archived vacancy or an unknown layout is unreadable", () => {
    const open = fixture("synthetic-vacancy-open.html")
    expect(readResponseStatus(open, "100500", "https://hh.ru/vacancy/999").state).toBe("unreadable")
    expect(readResponseStatus(open, "100500", "https://hh.ru/account/login").state).toBe("unreadable")
    expect(readResponseStatus('<h1 data-qa="vacancy-title">x</h1>', "100500", URL_OK).state).toBe(
      "unreadable"
    )
    expect(readResponseStatus("<html></html>", "100500", URL_OK).state).toBe("unreadable")
  })

  test("a trailing slash and a query on the url are fine", () => {
    const open = fixture("synthetic-vacancy-open.html")
    expect(
      readResponseStatus(open, "100500", "https://hh.ru/vacancy/100500/?hhtmFrom=x").state
    ).toBe("not_responded")
  })
})

import { parseNegotiations as parseWithResume } from "../src/negotiations.ts"

describe("negotiation resume", () => {
  const page = (topic: object) =>
    `<template id="HH-Lux-InitialState">${JSON.stringify({ applicantNegotiations: { topicList: [topic] } })}</template>`
  test("reads the resume the response was sent with", () => {
    expect(parseWithResume(page({ vacancyId: 1, resumeId: 289972366 })).topics[0]?.resumeId).toBe("289972366")
    expect(parseWithResume(page({ vacancyId: 1, resume: { id: "5" } })).topics[0]?.resumeId).toBe("5")
    expect(parseWithResume(page({ vacancyId: 1 })).topics[0]?.resumeId).toBeNull()
  })
})

describe("parseNegotiations on a live topic", () => {
  // Shape of a real logged-in page (2026-11-05): numeric ids, `chatId`, and
  // one topic per resume for the same vacancy, each with its own chat.
  const topic = (chatId: number, resumeId: number, lastState: string) => ({
    id: chatId - 1,
    chatId,
    communicationContext: { chatData: { id: chatId, type: "NEGOTIATION", subtype: null } },
    initialState: "RESPONSE",
    lastState,
    lastSubState: "SHOW",
    archived: false,
    discardReason: lastState === "DISCARD" ? "DISCARD_BY_EMPLOYER" : null,
    lastModified: "2026-11-05T18:56:12.847+03:00",
    vacancyId: 138673985,
    resumeId,
    resources: [{ id: 138673985, type: "VACANCY" }, { id: resumeId, type: "RESUME" }],
    actions: [{ name: "delete", method: "POST", href: "/applicant/negotiations/trash", substate: "HIDE" }],
    aiInterview: null
  })
  const page = JSON.stringify({
    applicantNegotiations: {
      topicList: [topic(5770068788, 290733333, "RESPONSE"), topic(5732439170, 289972366, "DISCARD")]
    }
  })
  const html = `<html><body><template id="HH-Lux-InitialState">${page}</template></body></html>`

  test("keeps the chat and resume of every response to the same vacancy", () => {
    const parsed = parseWithResume(html)
    expect(parsed.readable).toBe(true)
    expect(parsed.topics.map((item) => [item.vacancyId, item.resumeId, item.chatId, item.state])).toEqual([
      ["138673985", "290733333", "5770068788", "RESPONSE"],
      ["138673985", "289972366", "5732439170", "DISCARD"]
    ])
  })
})
