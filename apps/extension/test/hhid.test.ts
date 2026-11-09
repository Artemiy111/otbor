import { expect, test } from "bun:test"
import { hhidOfText } from "../src/hhid.ts"

test("чужой hhid работодателя числом не принимается за свой", () => {
  const state = '{"employerManager":{"hhid":153758778,"managerId":1},"resume":{"hhid":"197366351","id":"2"}}'
  expect(hhidOfText(state)).toBe("197366351")
})

test("нет строкового hhid — нет ответа", () => {
  expect(hhidOfText('{"employerManager":{"hhid":153758778}}')).toBeNull()
})
