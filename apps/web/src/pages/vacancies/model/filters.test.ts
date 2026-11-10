import { describe, expect, test } from "bun:test"
import {
  DEFAULT_FILTERS,
  activeChips,
  emptyCopy,
  filtersToSearch,
  fitBand,
  fitPercent,
  isNewVacancy,
  parseFilters,
  quickViewQuery,
  resolveSince,
  withoutChip
} from "./filters"

describe("адрес и фильтры", () => {
  test("чистый список - пустой адрес и умолчания", () => {
    expect(parseFilters("")).toEqual(DEFAULT_FILTERS)
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("")
  })

  test("запись и чтение возвращают те же фильтры", () => {
    const filters = {
      q: "devops москва",
      view: "apply" as const,
      sort: "fit" as const,
      account: "acc-1",
      archived: true,
      blacklisted: true,
      analysed: "yes" as const,
      page: 2
    }
    const search = filtersToSearch(filters)
    expect(search).toContain("page=3")
    expect(parseFilters(`?${search}`)).toEqual(filters)
  })

  test("битые значения дают умолчание", () => {
    const parsed = parseFilters("?view=boom&sort=nope&analysed=maybe&page=-4&archived=yes")
    expect(parsed).toEqual(DEFAULT_FILTERS)
    expect(parseFilters("?page=abc").page).toBe(0)
  })

  test("account=all отличается от основного аккаунта", () => {
    expect(parseFilters("?account=all").account).toBe("all")
    expect(parseFilters("").account).toBeNull()
  })

  test("быстрые фильтры превращаются в параметры запроса", () => {
    expect(quickViewQuery("all", "x")).toEqual({})
    expect(quickViewQuery("new", "2026-01-01T00:00:00.000Z")).toEqual({ seenSince: "2026-01-01T00:00:00.000Z" })
    expect(quickViewQuery("apply", "x")).toEqual({ verdict: "apply" })
    expect(quickViewQuery("open", "x")).toEqual({ applied: "no" })
    expect(quickViewQuery("applied", "x")).toEqual({ applied: "yes" })
  })
})

describe("чипы активных фильтров", () => {
  const name = (id: string) => (id === "a1" ? "Основной" : id)

  test("умолчания чипов не дают, быстрый фильтр тоже", () => {
    expect(activeChips({ ...DEFAULT_FILTERS, view: "new" }, name, 0)).toEqual([])
  })

  test("каждый чип снимается одним шагом и сбрасывает страницу", () => {
    const filters = { ...DEFAULT_FILTERS, q: "go", account: "a1", archived: true, analysed: "no" as const, page: 3 }
    const chips = activeChips(filters, name, 2)
    expect(chips.map((chip) => chip.key)).toEqual(["q", "account", "archived", "analysed", "rules"])
    expect(chips.find((chip) => chip.key === "account")?.label).toBe("Аккаунт: Основной")
    for (const chip of chips) {
      const next = withoutChip(filters, chip.key)
      expect(next.page).toBe(0)
      expect(activeChips(next, name, 0).some((item) => item.key === chip.key)).toBe(false)
    }
  })
})

describe("новые вакансии", () => {
  const now = new Date("2026-11-10T12:00:00.000Z")

  test("граница - прошлый визит", () => {
    expect(resolveSince("2026-11-09T08:00:00.000Z", now)).toBe("2026-11-09T08:00:00.000Z")
  })

  test("пусто, мусор или время из будущего дают последние сутки", () => {
    const dayAgo = "2026-11-09T12:00:00.000Z"
    expect(resolveSince(null, now)).toBe(dayAgo)
    expect(resolveSince("", now)).toBe(dayAgo)
    expect(resolveSince("вчера", now)).toBe(dayAgo)
    expect(resolveSince("2030-01-01T00:00:00.000Z", now)).toBe(dayAgo)
  })

  test("вакансия новая, если найдена не раньше границы", () => {
    expect(isNewVacancy("2026-11-09T08:00:00.000Z", "2026-11-09T08:00:00.000Z")).toBe(true)
    expect(isNewVacancy("2026-11-09T07:59:59.000Z", "2026-11-09T08:00:00.000Z")).toBe(false)
    expect(isNewVacancy("не дата", "2026-11-09T08:00:00.000Z")).toBe(false)
  })
})

describe("соответствие", () => {
  test("полосы по границам", () => {
    expect(fitBand(100)).toBe("high")
    expect(fitBand(75)).toBe("high")
    expect(fitBand(74)).toBe("mid")
    expect(fitBand(50)).toBe("mid")
    expect(fitBand(49)).toBe("low")
    expect(fitBand(0)).toBe("low")
  })

  test("шкала зажата в 0..100", () => {
    expect(fitPercent(130)).toBe(100)
    expect(fitPercent(-5)).toBe(0)
    expect(fitPercent(62.4)).toBe(62)
  })
})

describe("пустое состояние", () => {
  test("под каждый быстрый фильтр свои слова", () => {
    expect(emptyCopy({ ...DEFAULT_FILTERS, view: "new" }, false).title).toBe("Новых вакансий с прошлого визита нет")
    expect(emptyCopy({ ...DEFAULT_FILTERS, view: "apply" }, false).title).toBe("Подходящих вакансий нет")
  })

  test("при активных фильтрах пустота объясняется ими", () => {
    expect(emptyCopy({ ...DEFAULT_FILTERS, q: "x", view: "new" }, false).title).toBe("Ничего не найдено")
    expect(emptyCopy(DEFAULT_FILTERS, true).title).toBe("Ничего не найдено")
  })
})
