import type { FormQuestion } from "@otbor/contract"

/**
 * A model's answer to the draft prompt, checked against the real form.
 *
 * The model is untrusted text. Only known question ids survive, only option
 * ids the question really has, single choice keeps one option, free text is
 * cut to `maxLength`, and code tasks are answered as text like any other question.
 * Anything dropped is reported in `problems`, never silently.
 */
export interface DraftAnswer {
  readonly questionId: string
  readonly optionIds?: ReadonlyArray<string>
  readonly text?: string
}

export interface GeneratedDraft {
  readonly letter: string | null
  readonly answers: ReadonlyArray<DraftAnswer>
  readonly problems: ReadonlyArray<string>
}

/** The first balanced JSON object in the text, with or without a markdown fence. */
const extractJson = (text: string): unknown => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)

export const parseGeneratedDraft = (
  text: string,
  questions: ReadonlyArray<FormQuestion>
): GeneratedDraft => {
  const parsed = extractJson(text)
  if (parsed === null || typeof parsed !== "object") {
    return { letter: null, answers: [], problems: ["the model did not return JSON"] }
  }
  const root = parsed as { letter?: unknown; answers?: unknown }
  const problems: Array<string> = []

  const letterText = asString(root.letter)?.trim() ?? ""
  const letter = letterText === "" ? null : letterText

  const byId = new Map(questions.map((question) => [question.id, question]))
  const answers: Array<DraftAnswer> = []
  const seen = new Set<string>()

  for (const raw of Array.isArray(root.answers) ? root.answers : []) {
    const item = raw as { questionId?: unknown; optionIds?: unknown; text?: unknown } | null
    const id = typeof item?.questionId === "string" ? item.questionId : String(item?.questionId ?? "")
    const question = byId.get(id)
    if (question === undefined) {
      problems.push(`unknown question ${id}`)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)

    if (question.kind === "single" || question.kind === "multiple") {
      const known = new Set(question.options.map((option) => option.id))
      const chosen = (Array.isArray(item?.optionIds) ? item.optionIds : [])
        .map((value) => String(value))
        .filter((value) => known.has(value))
      const optionIds = question.kind === "single" ? chosen.slice(0, 1) : [...new Set(chosen)]
      if (optionIds.length === 0) {
        problems.push(`no valid option for question ${id}`)
        continue
      }
      answers.push({ questionId: id, optionIds })
      continue
    }
    const value = asString(item?.text)?.trim() ?? ""
    if (value === "") {
      problems.push(`empty answer for question ${id}`)
      continue
    }
    answers.push({
      questionId: id,
      text: question.maxLength != null ? value.slice(0, question.maxLength) : value
    })
  }

  for (const question of questions) {
    if (question.required && !seen.has(question.id)) {
      problems.push(`no answer for required question ${question.id}`)
    }
  }
  return { letter, answers, problems }
}
