import { describe, expect, test } from "bun:test"
import { normalizeSearchUrl, searchTextFromUrl } from "../src/url.ts"

describe("search URL normalization", () => {
  test("drops paging, sessions and referral noise", () => {
    expect(
      normalizeSearchUrl(
        "https://hh.ru/search/vacancy?text=devops&area=1&page=3" +
          "&hhtmFrom=main&search_session_id=abc&from=search&src=top"
      )
    ).toBe("https://hh.ru/search/vacancy?area=1&text=devops")
  })

  test("sorts parameters and normalizes host and trailing slash", () => {
    expect(
      normalizeSearchUrl("https://www.hh.ru/search/vacancy/?text=sre&order_by=publication_time#x")
    ).toBe("https://hh.ru/search/vacancy?order_by=publication_time&text=sre")
    expect(
      normalizeSearchUrl("https://m.hh.ru/search/vacancy?area=2&text=sre")
    ).toBe("https://hh.ru/search/vacancy?area=2&text=sre")
  })

  test("keeps an unparseable value as typed text", () => {
    expect(normalizeSearchUrl("  not a url  ")).toBe("not a url")
  })

  test("reads the text query used as a human label", () => {
    expect(searchTextFromUrl("https://hh.ru/search/vacancy?text=devops%20lead&area=1")).toBe(
      "devops lead"
    )
    expect(searchTextFromUrl("https://hh.ru/search/vacancy?area=1")).toBeNull()
    expect(searchTextFromUrl("not a url")).toBeNull()
  })
})
