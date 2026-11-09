import { describe, expect, test } from "bun:test"
import { decideBump, normalizeBumpText, parseLastBump } from "../src/resumeBump.ts"

const NBSP = " "

describe("кнопка «Поднять в поиске»", () => {
  test("рабочая кнопка с неразрывным пробелом в подписи нажимается", () => {
    expect(decideBump({ label: `Поднять в${NBSP}поиске`, href: null })).toEqual({ _tag: "click" })
  })

  test("обычный пробел и лишние пробелы вокруг тоже подходят", () => {
    expect(decideBump({ label: "  Поднять в поиске \n", href: null })._tag).toBe("click")
  })

  test("кнопка-реклама подписки не нажимается", () => {
    const decision = decideBump(null, {
      label: "Поднимать автоматически",
      href: "/applicant-services/hhpro?hhtmFrom=resume"
    })
    expect(decision._tag).toBe("unavailable")
  })

  test("подпись верная, но ссылка ведёт на подписку: не нажимается", () => {
    const decision = decideBump({
      label: "Поднять в поиске",
      href: "/applicant-services/hhpro?hhtmFrom=resume"
    })
    expect(decision._tag).toBe("unavailable")
  })

  test("чужая подпись не нажимается и попадает в сообщение", () => {
    const decision = decideBump({ label: "Поднимать автоматически", href: null })
    expect(decision._tag).toBe("unavailable")
    if (decision._tag === "unavailable") expect(decision.label).toBe("Поднимать автоматически")
  })

  test("отключённая кнопка не нажимается", () => {
    expect(decideBump({ label: "Поднять в поиске", href: null, disabled: true })._tag).toBe("unavailable")
  })

  test("кнопки нет совсем: недоступно", () => {
    expect(decideBump(null)._tag).toBe("unavailable")
  })

  test("normalizeBumpText склеивает неразрывные пробелы", () => {
    expect(normalizeBumpText(`Поднять в${NBSP}поиске`)).toBe("Поднять в поиске")
  })
})

describe("строка «Последнее»", () => {
  test("достаёт текст после тире", () => {
    expect(parseLastBump("Поднятие резюме\nПоследнее — 08 ноября в 19:15\nПоднять в поиске")).toBe(
      "08 ноября в 19:15"
    )
  })

  test("неразрывные пробелы нормализуются", () => {
    expect(parseLastBump(`Последнее${NBSP}— 08${NBSP}ноября в${NBSP}19:15`)).toBe("08 ноября в 19:15")
  })

  test("без строки возвращает null", () => {
    expect(parseLastBump("Поднятие резюме")).toBeNull()
  })
})
