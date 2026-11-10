import { describe, expect, test } from "bun:test"
import {
  EMPTY_FILTER,
  applicationLinkFrom,
  contextFromSearch,
  decodeContext,
  encodeContext,
  filterStates,
  filterToSearch,
  matchesFilter,
  parseFilter,
  withTab
} from "./filter"

describe("parseFilter", () => {
  test("пустой адрес - все отклики", () => {
    expect(parseFilter("")).toEqual(EMPTY_FILTER)
  })

  test("ссылки обзора ?state= продолжают работать и выбирают вкладку", () => {
    expect(parseFilter("?state=needs_human")).toMatchObject({ state: "needs_human", tab: "attention" })
    expect(parseFilter("?state=failed")).toMatchObject({ state: "failed", tab: "attention" })
    expect(parseFilter("?state=draft")).toMatchObject({ state: "draft", tab: "attention" })
    expect(parseFilter("?state=preparing")).toMatchObject({ tab: "active" })
    expect(parseFilter("?state=skipped")).toMatchObject({ state: "skipped", tab: "all" })
  })

  test("вкладка, причина, режим, аккаунт и поиск", () => {
    expect(parseFilter("?tab=active&reason=captcha&auto=1&account=a1&q=rust")).toEqual({
      tab: "active",
      state: null,
      reason: "captcha",
      mode: "any_auto",
      account: "a1",
      q: "rust"
    })
    expect(parseFilter("auto=drafts").mode).toBe("drafts")
    expect(parseFilter("auto=manual").mode).toBe("manual")
  })

  test("неизвестные значения отбрасываются", () => {
    expect(parseFilter("?state=bogus&tab=nope&reason=zzz&auto=7")).toEqual(EMPTY_FILTER)
  })
})

describe("filterToSearch", () => {
  test("значения по умолчанию опускаются", () => {
    expect(filterToSearch(EMPTY_FILTER)).toBe("")
    expect(filterToSearch(parseFilter("?state=needs_human"))).toBe("state=needs_human")
  })

  test("запись и чтение возвращают тот же фильтр", () => {
    for (const search of [
      "tab=attention",
      "tab=sent&account=a1",
      "state=failed&reason=captcha",
      "tab=active&auto=1",
      "reason=no_resume&auto=drafts&q=%D0%B3%D0%BE",
      "tab=attention&state=skipped"
    ]) {
      const filter = parseFilter(search)
      expect(parseFilter(filterToSearch(filter))).toEqual(filter)
    }
  })

  test("клик по вкладке снимает точное состояние", () => {
    const next = withTab(parseFilter("?state=failed"), "sent")
    expect(next.state).toBeNull()
    expect(filterToSearch(next)).toBe("tab=sent")
  })
})

describe("состояния для запроса", () => {
  test("вкладки и точное состояние", () => {
    expect(filterStates(parseFilter("?tab=attention"))).toEqual(["needs_human", "failed", "draft"])
    expect(filterStates(parseFilter("?tab=active"))).toEqual(["preparing", "queued", "submitting"])
    expect(filterStates(parseFilter("?tab=sent"))).toEqual(["submitted"])
    expect(filterStates(parseFilter(""))).toEqual([])
    expect(filterStates(parseFilter("?state=failed"))).toEqual(["failed"])
  })
})

describe("контекст очереди", () => {
  test("кодируется и читается обратно, в том числе со служебными символами", () => {
    const filter = parseFilter("?tab=attention&reason=captcha&q=a%3Bb%3Ac")
    const context = encodeContext(filter)
    expect(decodeContext(context)).toEqual(filter)
    expect(contextFromSearch(`?from=${encodeURIComponent(context)}`)).toEqual(filter)
  })

  test("пустой или битый контекст - нет очереди", () => {
    expect(decodeContext(null)).toBeNull()
    expect(decodeContext("")).toBeNull()
    expect(contextFromSearch("")).toBeNull()
  })

  test("ссылка на отклик помнит список", () => {
    expect(applicationLinkFrom("abc", parseFilter("?state=needs_human"))).toBe("/applications/abc?from=state%3Aneeds_human")
    expect(applicationLinkFrom("abc", EMPTY_FILTER)).toBe("/applications/abc?from=tab%3Aall")
    const link = applicationLinkFrom("abc", parseFilter("?state=failed&reason=captcha"))
    expect(contextFromSearch(link.slice(link.indexOf("?")))).toEqual(parseFilter("?state=failed&reason=captcha"))
  })
})

describe("matchesFilter (запасной путь на клиенте)", () => {
  const row = { state: "needs_human", blockedReason: "captcha", autoRun: "auto" as const, hhAccountId: "a1", vacancyTitle: "Rust Dev", employerName: "Acme" }
  test("совпадает и отсекает по каждому полю", () => {
    expect(matchesFilter(row, parseFilter("?tab=attention"))).toBe(true)
    expect(matchesFilter(row, parseFilter("?tab=sent"))).toBe(false)
    expect(matchesFilter(row, parseFilter("?reason=captcha"))).toBe(true)
    expect(matchesFilter(row, parseFilter("?reason=no_resume"))).toBe(false)
    expect(matchesFilter(row, parseFilter("?auto=1"))).toBe(true)
    expect(matchesFilter(row, parseFilter("?auto=manual"))).toBe(false)
    expect(matchesFilter(row, parseFilter("?auto=drafts"))).toBe(false)
    expect(matchesFilter(row, parseFilter("?q=acme"))).toBe(true)
    expect(matchesFilter(row, parseFilter("?q=go"))).toBe(false)
    expect(matchesFilter(row, parseFilter("?account=a2"))).toBe(false)
  })
})
