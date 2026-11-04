import { describe, expect, test } from "bun:test"
import type { FormQuestion } from "@otbor/contract"
import { parseGeneratedDraft } from "../src/index.ts"

const questions: ReadonlyArray<FormQuestion> = [
  {
    id: "1",
    kind: "single",
    text: "Формат?",
    options: [{ id: "10", label: "Офис" }, { id: "11", label: "Удалённо" }],
    required: true
  },
  {
    id: "2",
    kind: "multiple",
    text: "Стек",
    options: [{ id: "20", label: "Go" }, { id: "21", label: "Rust" }],
    required: false
  },
  { id: "3", kind: "text", text: "Город", options: [], required: true, maxLength: 5 },
  { id: "4", kind: "code", text: "Задача", options: [], required: true }
]

describe("parseGeneratedDraft", () => {
  test("reads a fenced JSON object and keeps only valid answers", () => {
    const draft = parseGeneratedDraft(
      '```json\n{"letter":" Здравствуйте ","answers":[{"questionId":"1","optionIds":["11","10"]},{"questionId":"2","optionIds":["20","99"]},{"questionId":"3","text":"Москва-город"},{"questionId":"4","text":"print()"},{"questionId":"77","text":"x"}]}\n```',
      questions
    )
    expect(draft.letter).toBe("Здравствуйте")
    expect(draft.answers).toEqual([
      { questionId: "1", optionIds: ["11"] },
      { questionId: "2", optionIds: ["20"] },
      { questionId: "3", text: "Москв" }
    ])
    expect(draft.problems.join("|")).toContain("code task")
    expect(draft.problems.join("|")).toContain("unknown question 77")
  })

  test("reports a missing required answer and unparseable text", () => {
    expect(parseGeneratedDraft('{"letter":"Привет","answers":[]}', questions).problems).toContain(
      "no answer for required question 1"
    )
    expect(parseGeneratedDraft("no json here", questions)).toEqual({
      letter: null,
      answers: [],
      problems: ["the model did not return JSON"]
    })
  })
})
