import { describe, expect, test } from "bun:test"
import { confidencePercent, contactLinkText } from "./model"

describe("confidencePercent", () => {
  test("доли и проценты приводятся к процентам", () => {
    expect(confidencePercent(0.9)).toBe(90)
    expect(confidencePercent(85)).toBe(85)
    expect(confidencePercent(null)).toBeNull()
  })
})

describe("contactLinkText", () => {
  test("способ связи и уверенность", () => {
    expect(contactLinkText("auto", 0.9)).toBe("определён автоматически · 90%")
    expect(contactLinkText("suggested", null)).toBe("предложен, нужна проверка")
    expect(contactLinkText(null, null)).toBe("не привязан")
  })
})
