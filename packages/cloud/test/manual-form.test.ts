/**
 * What the manual flow can show the agent for a vacancy with an employer test:
 * the response form parsed from the recorded hh.ru fixtures, the hints derived
 * from it (hard, blockers) and what approve will refuse. Pure: no database.
 */
import type { FormAnswer, StoredHint } from "@otbor/contract"
import { answerHints } from "@otbor/domain"
import { parseResponseForm } from "@otbor/hh"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkKit } from "../src/services/applyRules.ts"
import { externalIdFromReference, vacancyPageUrl } from "../src/services/vacancyReference.ts"

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")
const URL_OK = "https://hh.ru/applicant/vacancy_response?vacancyId=100500"

const testForm = parseResponseForm(fixture("hh-test-response.html"), URL_OK)
const codeForm = parseResponseForm(fixture("hh-test-code.html"), URL_OK)

const SALARY_QUESTION = "387049560"

const stored = (hints: ReturnType<typeof answerHints>): ReadonlyArray<StoredHint> =>
  hints.map((hint) => ({
    questionId: hint.questionId,
    kind: hint.kind,
    ...(hint.optionIds === undefined ? {} : { optionIds: hint.optionIds }),
    ...(hint.text === undefined ? {} : { text: hint.text }),
    hard: hint.hard,
    confidence: hint.confidence,
    note: hint.note,
    evidence: hint.evidence,
    blockers: hint.blockers
  }))

const answer = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "model",
  hard: false,
  needsHuman: false,
  ...extra
})

describe("manual mode: an employer test is readable", () => {
  test("the recorded test page yields every task with kinds, options and required flags", () => {
    expect(testForm.layout).toBe("known")
    expect(testForm.questions.map((q) => q.kind)).toEqual(["single", "single", "text", "multiple", "text"])
    expect(testForm.questions.every((q) => q.required)).toBe(true)
    expect(testForm.questions[0]?.options.length).toBeGreaterThan(1)
  })

  test("a code task is a code question and gets no hint", () => {
    const code = codeForm.questions.find((q) => q.kind === "code")
    expect(code).toMatchObject({ kind: "code", codeLanguage: "python" })
    const hints = answerHints({
      questions: codeForm.questions,
      vacancy: { areaName: "Москва", salaryFrom: null, salaryTo: null, salaryCurrency: null, workFormats: ["remote"] },
      salary: null,
      resumeWorkFormats: ["remote"]
    })
    expect(hints.find((hint) => hint.questionId === code!.id)).toBeUndefined()
  })

  test("a salary hint with blockers survives to the stored hint and demands a human", () => {
    const hints = stored(answerHints({
      questions: testForm.questions,
      vacancy: { areaName: "Москва", salaryFrom: 100_000, salaryTo: 200_000, salaryCurrency: "RUR", workFormats: ["remote"] },
      salary: { expectation: 300_000, minimum: 250_000, currency: "RUB" },
      resumeWorkFormats: ["remote"]
    }))
    const salary = hints.find((hint) => hint.questionId === SALARY_QUESTION)
    expect(salary?.blockers.length).toBeGreaterThan(0)

    const modelAnswers = testForm.questions.map((q) =>
      q.options.length > 0
        ? answer(q.id, { optionIds: [q.options[0]!.id] })
        : answer(q.id, { text: salary?.text ?? "200000" })
    )
    const problems = checkKit({
      form: testForm,
      hints,
      kit: { formHash: testForm.formHash, letter: "Письмо", answers: modelAnswers }
    })
    expect(problems.some((p) => p.questionId === SALARY_QUESTION)).toBe(true)
  })

  test("a code answer written by the model is refused, one from the user is not", () => {
    const code = codeForm.questions.find((q) => q.kind === "code")!
    const others = codeForm.questions.filter((q) => q.id !== code.id)
    const rest = others.map((q) => answer(q.id, { text: "Коротко.", source: "human" }))
    const kit = (source: "model" | "human") => ({
      formHash: codeForm.formHash,
      letter: "Письмо",
      answers: [...rest, answer(code.id, { text: "def f(): pass", source })]
    })
    expect(checkKit({ form: codeForm, hints: [], kit: kit("model") }).map((p) => p.questionId)).toContain(code.id)
    expect(checkKit({ form: codeForm, hints: [], kit: kit("human") }).map((p) => p.questionId)).not.toContain(code.id)
  })
})

describe("externalIdFromReference", () => {
  test("accepts ids and hh.ru vacancy URLs", () => {
    expect(externalIdFromReference("123456789")).toBe("123456789")
    expect(externalIdFromReference("https://hh.ru/vacancy/123456789")).toBe("123456789")
    expect(externalIdFromReference("https://hh.ru/vacancy/123456789?query=a&hhtmFrom=b")).toBe("123456789")
    expect(externalIdFromReference("hh.ru/vacancy/42424242/")).toBe("42424242")
    expect(externalIdFromReference("https://spb.hh.ru/vacancy/555555")).toBe("555555")
    expect(externalIdFromReference("  https://hh.kz/vacancy/777777  ")).toBe("777777")
  })

  test("refuses everything that is not an hh vacancy", () => {
    expect(externalIdFromReference("")).toBeNull()
    expect(externalIdFromReference("12")).toBeNull()
    expect(externalIdFromReference("https://example.com/vacancy/123456")).toBeNull()
    expect(externalIdFromReference("https://hh.ru.evil.example/vacancy/123456")).toBeNull()
    expect(externalIdFromReference("https://evilhh.ru/vacancy/123456")).toBeNull()
    expect(externalIdFromReference("https://hh.ru/employer/123456")).toBeNull()
    expect(externalIdFromReference("ftp://hh.ru/vacancy/123456")).toBeNull()
    expect(externalIdFromReference("0190c8f5-8c2b-7abc-8def-000000000001")).toBeNull()
  })

  test("the page that is requested is always the canonical one", () => {
    expect(vacancyPageUrl("123456789")).toBe("https://hh.ru/vacancy/123456789")
  })
})
