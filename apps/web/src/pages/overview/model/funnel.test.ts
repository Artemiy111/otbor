import { describe, expect, test } from "bun:test"
import { buildFunnel, buildSkipRows } from "./funnel"
import { buildHeroNumbers, deltaOf, rate } from "./hero"
import { makeOverview } from "./overview.fixture"

describe("rate и deltaOf", () => {
  test("rate: деление на ноль даёт null, малые доли с десятыми", () => {
    expect(rate(1, 0)).toBeNull()
    expect(rate(1, 3)).toBe(33)
    expect(rate(5, 100)).toBe(5)
    expect(rate(3, 1000)).toBe(0.3)
  })

  test("deltaOf: рост, падение, без базы и без изменений", () => {
    expect(deltaOf(120, 100)).toEqual({ text: "+20 %", direction: "up" })
    expect(deltaOf(50, 100)).toEqual({ text: "−50 %", direction: "down" })
    expect(deltaOf(7, 0)).toEqual({ text: "+7", direction: "up" })
    expect(deltaOf(0, 0)).toBeNull()
    expect(deltaOf(10, 10)).toEqual({ text: "без изменений", direction: "flat" })
  })
})

describe("buildFunnel", () => {
  const stages = buildFunnel(makeOverview().funnel)

  test("шесть ступеней в порядке воронки", () => {
    expect(stages.map((stage) => stage.id)).toEqual(["found", "matched", "created", "sent", "viewed", "invited"])
  })

  test("конверсия считается от предыдущей ступени внутри группы", () => {
    const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage]))
    expect(byId.matched?.rateFromPrevious).toBe(20)
    expect(byId.sent?.rateFromPrevious).toBe(67)
    expect(byId.viewed?.rateFromPrevious).toBe(40)
    expect(byId.invited?.rateFromPrevious).toBe(13)
  })

  test("между группами конверсии нет, ступень «создано» ровно по ширине", () => {
    const created = stages.find((stage) => stage.id === "created")
    expect(created?.rateFromPrevious).toBeNull()
    expect(created?.width).toBe(100)
  })

  test("доля больше 100 % не показывается (разные выборки)", () => {
    const wide = buildFunnel({ ...makeOverview().funnel, decisionsApply: 5000 })
    expect(wide.find((stage) => stage.id === "matched")?.rateFromPrevious).toBeNull()
  })

  test("нулевая воронка не падает и даёт нулевые полосы", () => {
    const zero = buildFunnel({
      vacanciesFound: 0, decisionsApply: 0, decisionsSkip: 0, applicationsCreated: 0, sent: 0, viewed: 0, invited: 0, rejected: 0
    })
    expect(zero.every((stage) => stage.value === 0 && stage.width === 0 && stage.rateFromPrevious === null)).toBe(true)
  })

  test("отказы и пропуски идут приглушённой добавкой", () => {
    expect(stages.find((stage) => stage.id === "invited")?.aside).toBe("отказов 20")
    expect(stages.find((stage) => stage.id === "matched")?.aside).toContain("пропущено")
  })
})

describe("buildSkipRows", () => {
  test("русские названия, доли и ширина относительно максимума", () => {
    const rows = buildSkipRows([
      { code: "blocked_filter", count: 75 },
      { code: "role_unknown", count: 25 },
      { code: "something_new", count: 0 }
    ])
    expect(rows[0]).toMatchObject({ label: "Не прошла фильтр откликов", share: 75, width: 100 })
    expect(rows[1]).toMatchObject({ label: "Роль вакансии неясна", share: 25, width: 33.33333333333333 })
    expect(rows[2]?.label).toBe("something_new")
  })
})

describe("buildHeroNumbers", () => {
  test("четыре числа, дельта к прошлому окну и конверсия в приглашение", () => {
    const numbers = buildHeroNumbers(makeOverview())
    expect(numbers.map((number) => number.id)).toEqual(["today", "window", "invited", "found"])
    expect(numbers[1]?.delta).toEqual({ text: "+25 %", direction: "up" })
    expect(numbers[2]?.hint).toBe("5 % от отправленных")
    expect(numbers[0]?.hint).toBe("из 200 по лимиту")
  })
})
