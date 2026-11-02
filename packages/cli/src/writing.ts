import type { Answer } from "@otbor/contract"
import { Answer as AnswerSchema } from "@otbor/contract"
import { Option, Schema } from "effect"

/**
 * The answers prompt asks for a bare JSON array, but a model may still wrap it
 * in prose or fences. Recover the outermost array and decode it with the same
 * contract the kit uses; anything else is not saved.
 */
export const parseAnswers = (text: string): ReadonlyArray<Answer> | null => {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end <= start) return null

  let json: unknown
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  const decoded = Schema.decodeUnknownOption(Schema.Array(AnswerSchema))(json)
  if (Option.isNone(decoded)) return null

  const answers = decoded.value.map((answer) => ({
    question: answer.question.trim(),
    answer: answer.answer.trim()
  }))
  if (answers.length === 0 || answers.some((answer) => answer.question === "" || answer.answer === "")) {
    return null
  }
  return answers
}

/** Stdin questions are one per line; blank lines are not questions. */
export const questionLines = (text: string): ReadonlyArray<string> =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
