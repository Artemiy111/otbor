import { describe, expect, test } from "bun:test"
import { areaChildren, areaCountry, areaPath, expandAreaIds, findArea, searchAreas } from "@otbor/contract/areas"

describe("hh area tree", () => {
  test("countries are top level and the 'other regions' container is gone", () => {
    const countries = areaChildren(0).map((area) => area.name)
    expect(countries).toContain("Россия")
    expect(countries).toContain("Германия")
    expect(findArea(1001)).toBeUndefined()
  })

  test("a city knows its country and path", () => {
    expect(areaCountry(160)?.name).toBe("Казахстан")
    expect(areaPath(1).map((area) => area.name)).toEqual(["Россия", "Москва"])
  })

  test("a country expands to all its cities, a city to itself", () => {
    const russia = expandAreaIds([113])
    expect(russia).toContain(113)
    expect(russia).toContain(1)
    expect(russia).not.toContain(160)
    expect(expandAreaIds([2])).toEqual([2])
    expect(expandAreaIds([99999999])).toEqual([99999999])
  })

  test("search puts prefix matches first", () => {
    const hits = searchAreas("минск", 5).map((area) => area.name)
    expect(hits[0]).toBe("Минск")
  })
})
