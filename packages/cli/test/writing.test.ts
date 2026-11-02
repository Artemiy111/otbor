import { describe, expect, test } from "bun:test"
import { parseAnswers, questionLines } from "../src/writing.ts"

describe("answer parsing", () => {
  test("accepts a bare JSON array", () => {
    const parsed = parseAnswers('[{"question":"Why us?","answer":"Because."}]')
    expect(parsed).toEqual([{ question: "Why us?", answer: "Because." }])
  })

  test("recovers an array wrapped in prose or fences", () => {
    const parsed = parseAnswers(
      'Here you go:\n```json\n[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2"}]\n```\nDone.'
    )
    expect(parsed).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" }
    ])
  })

  test("rejects malformed JSON, wrong shapes and blank fields", () => {
    expect(parseAnswers("no array here")).toBeNull()
    expect(parseAnswers('[{"question":1,"answer":"A"}]')).toBeNull()
    expect(parseAnswers('[{"question":"Q","answer":""}]')).toBeNull()
    expect(parseAnswers("[]")).toBeNull()
    expect(parseAnswers('{"question":"Q","answer":"A"}')).toBeNull()
  })
})

describe("stdin questions", () => {
  test("keeps one question per line and drops blanks", () => {
    expect(questionLines(" Why us? \n\nSecond question\r\nThird\n")).toEqual([
      "Why us?",
      "Second question",
      "Third"
    ])
  })
})
