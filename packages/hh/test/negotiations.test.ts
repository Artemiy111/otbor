import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  initialStateFragment,
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
      topics: []
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
    expect(parseNegotiations(html)).toEqual({ readable: false, topics: [] })
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
