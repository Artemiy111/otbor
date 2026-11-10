import { describe, expect, test } from "bun:test"
import { countWord, plural, pluralIndex } from "./plural"

const FORMS = ["отклик", "отклика", "откликов"] as const

describe("plural", () => {
  test("берёт правильную форму для типичных чисел", () => {
    expect(plural(1, FORMS)).toBe("отклик")
    expect(plural(2, FORMS)).toBe("отклика")
    expect(plural(4, FORMS)).toBe("отклика")
    expect(plural(5, FORMS)).toBe("откликов")
    expect(plural(0, FORMS)).toBe("откликов")
    expect(plural(21, FORMS)).toBe("отклик")
    expect(plural(22, FORMS)).toBe("отклика")
    expect(plural(100, FORMS)).toBe("откликов")
    expect(plural(101, FORMS)).toBe("отклик")
  })

  test("числа 11-14 всегда во множественной форме «много»", () => {
    for (const value of [11, 12, 13, 14, 111, 112, 214]) expect(pluralIndex(value)).toBe(2)
  })

  test("отрицательные числа считаются по модулю", () => {
    expect(plural(-1, FORMS)).toBe("отклик")
    expect(plural(-3, FORMS)).toBe("отклика")
  })

  test("countWord разделяет тысячи", () => {
    expect(countWord(1204, FORMS).replace(/\s/g, " ")).toBe("1 204 отклика")
  })
})
