import { describe, expect, test } from "bun:test"
import { formatSearchUrl, normalizeSearchUrl, searchTextFromUrl } from "../src/url.ts"

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

  test("formats a normalized URL for humans without changing its meaning", () => {
    expect(
      formatSearchUrl(
        "https://hh.ru/search/vacancy?text=Devops-%D0%B8%D0%BD%D0%B6%D0%B5%D0%BD%D0%B5%D1%80&area=1"
      )
    ).toBe("https://hh.ru/search/vacancy?text=Devops-инженер&area=1")
    expect(formatSearchUrl("https://hh.ru/search/vacancy?text=sre+lead&area=1")).toBe(
      "https://hh.ru/search/vacancy?text=sre%20lead&area=1"
    )
    expect(
      formatSearchUrl("https://hh.ru/search/vacancy?text=a%26b%3Dc%2Bd&text=%25")
    ).toBe("https://hh.ru/search/vacancy?text=a%26b%3Dc%2Bd&text=%25")
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
