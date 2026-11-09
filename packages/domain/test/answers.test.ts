import { describe, expect, test } from "bun:test"
import type { FormAnswer, FormQuestion } from "@otbor/contract"
import {
  answerHints,
  checkTextStyle,
  classifyQuestion,
  salaryAnswer,
  validateAnswers,
  type HintInput
} from "../src/answers.ts"

const q = (partial: Partial<FormQuestion> & Pick<FormQuestion, "id" | "text">): FormQuestion => ({
  kind: "text",
  options: [],
  required: true,
  maxLength: null,
  codeLanguage: null,
  ...partial
})

const yesNoQuestion = (id: string, text: string): FormQuestion =>
  q({
    id,
    text,
    kind: "single",
    options: [
      { id: `${id}-y`, label: "Да" },
      { id: `${id}-n`, label: "Нет" }
    ]
  })

describe("classifyQuestion", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["Какой уровень заработной платы рассматриваете?", "salary"],
    ["Ваши зарплатные ожидания", "salary"],
    ["Укажите желаемый доход", "salary"],
    ["What is your expected salary?", "salary"],
    ["Какая зарплата была на предыдущем месте работы?", "other"],
    ["Current salary?", "other"],
    ["Готовы ли вы к удалённой работе?", "remote"],
    ["Рассматриваете дистанционный формат?", "remote"],
    ["Are you open to remote work?", "remote"],
    ["Готовы рассматривать гибридный или офисный график работы?", "office"],
    ["Готовы работать в офисе?", "office"],
    ["Are you ok with a hybrid schedule?", "office"],
    ["Готовы ли вы к переезду?", "relocation"],
    ["Are you willing to relocate?", "relocation"],
    ["В каком городе проживаете?", "city"],
    ["Where do you live?", "city"],
    ["Ваш город проживания", "city"],
    ["Какой у вас уровень английского?", "english"],
    ["Your English level?", "english"],
    ["Когда вы готовы приступить к работе?", "start_date"],
    ["What is your notice period?", "start_date"],
    ["Вы использовали Kubernetes?", "tool_experience"],
    ["Работали ли вы с PostgreSQL?", "tool_experience"],
    ["Have you used Terraform?", "tool_experience"],
    ["Сколько лет вы работали с Kubernetes?", "other"],
    ["Оформление на последнем месте работы было:", "other"],
    ["Расскажите о себе", "other"]
  ]
  for (const [text, expected] of cases) {
    test(`${expected}: ${text}`, () => {
      expect(classifyQuestion({ text })).toBe(expected as ReturnType<typeof classifyQuestion>)
    })
  }

  test("ё and case do not matter", () => {
    expect(classifyQuestion({ text: "УДАЛЁННАЯ работа" })).toBe("remote")
  })
})

describe("salaryAnswer table", () => {
  const rub = (expectation: number | null, minimum: number | null = null) => ({
    expectation,
    minimum,
    currency: "RUB"
  })

  test("from X to Y: max(expectation, middle), capped at Y", () => {
    // middle 200k, expectation 250k -> 250k
    expect(salaryAnswer(rub(250_000), { from: 150_000, to: 250_000, currency: "RUR" })).toMatchObject({
      text: "250 000",
      amount: 250_000,
      source: "both",
      blockers: []
    })
    // expectation below the middle -> middle
    expect(salaryAnswer(rub(100_000), { from: 150_000, to: 250_000, currency: "RUR" })?.amount).toBe(200_000)
    // expectation inside the cap
    expect(salaryAnswer(rub(220_000), { from: 150_000, to: 250_000, currency: "RUR" })?.amount).toBe(220_000)
  })

  test("from X to Y without own expectation: the middle, not the floor", () => {
    expect(salaryAnswer(null, { from: 100_000, to: 200_000, currency: null })).toMatchObject({
      text: "150 000",
      source: "vacancy"
    })
  })

  test("to Y below the expectation: Y", () => {
    expect(salaryAnswer(rub(300_000, 200_000), { from: null, to: 250_000, currency: "RUR" })).toMatchObject({
      text: "250 000",
      amount: 250_000,
      blockers: []
    })
  })

  test("only from X: max(expectation, X) as 'от N'", () => {
    expect(salaryAnswer(rub(300_000), { from: 200_000, to: null, currency: "RUR" })?.text).toBe("от 300 000")
    expect(salaryAnswer(rub(150_000), { from: 200_000, to: null, currency: "RUR" })?.text).toBe("от 200 000")
  })

  test("only from X and no expectation: no deterministic number", () => {
    expect(salaryAnswer(null, { from: 200_000, to: null, currency: "RUR" })).toBeNull()
  })

  test("only to Y: Y", () => {
    expect(salaryAnswer(rub(200_000), { from: null, to: 250_000, currency: "RUR" })?.text).toBe("250 000")
    expect(salaryAnswer(null, { from: null, to: 250_000, currency: null })?.text).toBe("250 000")
  })

  test("no vacancy range: the expectation", () => {
    expect(salaryAnswer(rub(300_000), { from: null, to: null, currency: null })).toMatchObject({
      text: "от 300 000",
      source: "expectation"
    })
  })

  test("the minimum is the fallback when there is no expectation", () => {
    expect(salaryAnswer(rub(null, 180_000), { from: null, to: null, currency: null })?.amount).toBe(180_000)
  })

  test("nothing at all", () => {
    expect(salaryAnswer(null, { from: null, to: null, currency: null })).toBeNull()
    expect(salaryAnswer(rub(null), { from: null, to: null, currency: null })).toBeNull()
  })

  test("upper bound below the minimum: the bound plus a blocker", () => {
    const answer = salaryAnswer(rub(300_000, 250_000), { from: 100_000, to: 200_000, currency: "RUR" })
    expect(answer).toMatchObject({ text: "200 000", amount: 200_000, blockers: ["upper_bound_below_minimum"] })
    expect(answer?.note).toContain("below the minimum")
  })

  test("upper bound below the expectation but above the minimum is not a blocker", () => {
    const answer = salaryAnswer(rub(300_000, 150_000), { from: 100_000, to: 200_000, currency: "RUR" })
    expect(answer).toMatchObject({ amount: 200_000, blockers: [] })
  })

  test("currency mismatch: no conversion, the vacancy figure with a blocker", () => {
    const answer = salaryAnswer(rub(300_000), { from: 3_000, to: 5_000, currency: "USD" })
    expect(answer).toMatchObject({ text: "4 000", currency: "USD", blockers: ["currency_mismatch"] })
  })

  test("RUR and RUB are the same currency", () => {
    expect(salaryAnswer(rub(300_000), { from: 200_000, to: 400_000, currency: "RUR" })?.blockers).toEqual([])
  })

  test("the text never carries a currency sign and always has a digit", () => {
    const text = salaryAnswer(rub(300_000), { from: null, to: null, currency: "RUR" })?.text ?? ""
    expect(text).toMatch(/\d/)
    expect(text).not.toMatch(/₽|руб|RUB|RUR/i)
  })
})

describe("answerHints", () => {
  const base: HintInput = {
    questions: [],
    vacancy: { areaName: "Москва", salaryFrom: null, salaryTo: null, salaryCurrency: null, workFormats: ["office"] },
    salary: { expectation: 300_000, minimum: 250_000, currency: "RUB" },
    resumeWorkFormats: ["remote", "hybrid"]
  }
  const hintsFor = (questions: ReadonlyArray<FormQuestion>, patch: Partial<HintInput> = {}) =>
    answerHints({ ...base, ...patch, questions })

  test("remote is always yes and hard, as an option", () => {
    const question = yesNoQuestion("1", "Готовы к удалённой работе?")
    expect(hintsFor([question])).toMatchObject([{ questionId: "1", kind: "remote", optionIds: ["1-y"], hard: true }])
  })

  test("remote on a text question answers in words", () => {
    const [hint] = hintsFor([q({ id: "1", text: "Готовы ли вы работать удалённо?" })])
    expect(hint).toMatchObject({ text: "Да", hard: true })
  })

  test("remote with no yes option produces no hint rather than a wrong one", () => {
    const question = q({ id: "1", text: "Удалённая работа?", kind: "single", options: [{ id: "a", label: "Возможно" }] })
    expect(hintsFor([question])).toEqual([])
  })

  test("salary hint is hard on text questions and carries blockers", () => {
    const question = q({ id: "2", text: "Какой уровень заработной платы рассматриваете?" })
    const [hint] = hintsFor([question], {
      vacancy: { ...base.vacancy, salaryFrom: 100_000, salaryTo: 200_000, salaryCurrency: "RUR" }
    })
    expect(hint).toMatchObject({ kind: "salary", text: "250 000".replace("250", "200"), hard: true })
    expect(hint?.blockers).toEqual(["upper_bound_below_minimum"])
    expect(hint?.confidence).toBeLessThan(0.5)
  })

  test("salary hint on a choice question is soft and textual", () => {
    const question = q({
      id: "2",
      text: "Зарплата?",
      kind: "single",
      options: [{ id: "a", label: "до 100000" }]
    })
    expect(hintsFor([question])[0]).toMatchObject({ kind: "salary", hard: false, text: "от 300 000" })
  })

  test("no salary data: no salary hint", () => {
    const question = q({ id: "2", text: "Ожидаемая зарплата?" })
    expect(hintsFor([question], { salary: null })).toEqual([])
  })

  test("office/hybrid come from the resume work formats", () => {
    const question = q({
      id: "3",
      text: "Готовы рассматривать гибридный или офисный график работы?",
      kind: "multiple",
      options: [
        { id: "both", label: "Да (офисный и гибридный)" },
        { id: "hyb", label: "Да (гибридный)" },
        { id: "no", label: "Нет (только удаленно)" }
      ]
    })
    expect(hintsFor([question])[0]).toMatchObject({ kind: "office", optionIds: ["hyb"], hard: true })
    expect(hintsFor([question], { resumeWorkFormats: ["remote"] })[0]).toMatchObject({ optionIds: ["no"] })
    expect(hintsFor([question], { resumeWorkFormats: ["office", "hybrid"] })[0]).toMatchObject({ optionIds: ["both"] })
  })

  test("office with no resume formats and no override: no hint", () => {
    const question = q({ id: "3", text: "Готовы работать в офисе?" })
    expect(hintsFor([question], { resumeWorkFormats: [] })).toEqual([])
  })

  test("profile override beats resume formats", () => {
    const question = q({ id: "3", text: "Готовы работать в офисе?" })
    expect(hintsFor([question], { profile: { office: true, hybrid: false } })[0]).toMatchObject({ text: "Да, офисный" })
  })

  test("relocation needs a profile fact", () => {
    const question = yesNoQuestion("4", "Готовы к переезду?")
    expect(hintsFor([question])).toEqual([])
    expect(hintsFor([question], { profile: { relocation: false } })[0]).toMatchObject({
      kind: "relocation",
      optionIds: ["4-n"],
      hard: true
    })
    expect(hintsFor([q({ id: "5", text: "Готовы к переезду?" })], { profile: { relocation: "negotiable" } })[0]).toMatchObject({
      text: "Обсуждаемо"
    })
  })

  test("city: on-site vacancy in another city gets the vacancy city, hard", () => {
    const question = q({ id: "6", text: "В каком городе проживаете?" })
    const [hint] = hintsFor([question], { profile: { city: "Казань" } })
    expect(hint).toMatchObject({ kind: "city", text: "Москва", hard: true })
  })

  test("city: same city or remote vacancy keeps the candidate's city, soft", () => {
    const question = q({ id: "6", text: "В каком городе проживаете?" })
    expect(hintsFor([question], { profile: { city: "Москва" } })[0]).toMatchObject({ text: "Москва", hard: false })
    expect(
      hintsFor([question], {
        profile: { city: "Казань" },
        vacancy: { ...base.vacancy, workFormats: ["remote"] }
      })[0]
    ).toMatchObject({ text: "Казань", hard: false })
  })

  test("city without a known resume city produces no hint", () => {
    expect(hintsFor([q({ id: "6", text: "В каком городе проживаете?" })])).toEqual([])
  })

  test("'have you used X' is yes and soft", () => {
    const question = yesNoQuestion("7", "Вы использовали Kubernetes?")
    expect(hintsFor([question])[0]).toMatchObject({ kind: "tool_experience", optionIds: ["7-y"], hard: false })
  })

  test("english and start date are soft facts", () => {
    const hints = hintsFor(
      [q({ id: "8", text: "Уровень английского?" }), q({ id: "9", text: "Когда готовы приступить?" })],
      { profile: { english: "B2", startDate: "через две недели" } }
    )
    expect(hints).toMatchObject([
      { kind: "english", text: "B2", hard: false },
      { kind: "start_date", text: "через две недели", hard: false }
    ])
  })

  test("code questions and unknown topics get nothing", () => {
    expect(
      hintsFor([q({ id: "10", text: "Реализуйте удалённый вызов", kind: "code" }), q({ id: "11", text: "Расскажите о себе" })])
    ).toEqual([])
  })
})

describe("checkTextStyle", () => {
  test("flags em dash, other long dashes, emoji and exclamation", () => {
    const codes = (text: string) => checkTextStyle(text).map((violation) => violation.code)
    expect(codes("Опыт — 5 лет")).toEqual(["dash"])
    expect(codes("a – b")).toEqual(["dash"])
    expect(codes("Готов 🚀")).toEqual(["emoji"])
    expect(codes("Да!")).toEqual(["exclamation"])
  })

  test("allowExclamation skips only the exclamation check", () => {
    expect(checkTextStyle("Да!", { allowExclamation: true })).toEqual([])
    expect(checkTextStyle("Да — !", { allowExclamation: true }).map((v) => v.code)).toEqual(["dash"])
  })

  test("plain hyphens and ordinary punctuation pass", () => {
    expect(checkTextStyle("Full-stack, 2020-2024. Да?")).toEqual([])
  })
})

describe("validateAnswers", () => {
  const form = {
    questions: [
      q({ id: "1", text: "Готовы к удалённой работе?", kind: "single", options: [{ id: "y", label: "Да" }, { id: "n", label: "Нет" }] }),
      q({ id: "2", text: "Какая зарплата вас интересует?", maxLength: 40 }),
      q({ id: "3", text: "Расскажите о себе", required: false, maxLength: 20 }),
      q({ id: "4", text: "Какие форматы?", kind: "multiple", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }),
      q({ id: "5", text: "Напишите функцию", kind: "code", required: false })
    ]
  }
  const ans = (questionId: string, patch: Partial<FormAnswer>): FormAnswer => ({
    questionId,
    source: "model",
    hard: false,
    needsHuman: false,
    ...patch
  })
  const hints = answerHints({
    questions: form.questions,
    vacancy: { areaName: null, salaryFrom: null, salaryTo: null, salaryCurrency: null, workFormats: [] },
    salary: { expectation: 300_000, minimum: null, currency: "RUB" },
    resumeWorkFormats: []
  })
  const valid: ReadonlyArray<FormAnswer> = [
    ans("1", { optionIds: ["y"], hard: true, source: "hint" }),
    ans("2", { text: "от 300 000", hard: true, source: "hint" }),
    ans("4", { optionIds: ["a", "b"] })
  ]
  const codes = (answers: ReadonlyArray<FormAnswer>) =>
    validateAnswers(form, answers, hints).map((error) => `${error.code}:${error.questionId}`)

  test("a consistent answer set passes", () => {
    expect(validateAnswers(form, valid, hints)).toEqual([])
  })

  test("hard hints hold", () => {
    expect(hints.map((hint) => [hint.questionId, hint.hard])).toEqual([
      ["1", true],
      ["2", true]
    ])
  })

  test("hard remote hint overridden", () => {
    expect(codes([ans("1", { optionIds: ["n"] }), ...valid.slice(1)])).toEqual(["hard_hint_overridden:1"])
  })

  test("hard salary hint overridden by a different number, but not by formatting", () => {
    expect(codes([valid[0]!, ans("2", { text: "от 250000" }), valid[2]!])).toEqual(["hard_hint_overridden:2"])
    expect(codes([valid[0]!, ans("2", { text: "300000" }), valid[2]!])).toEqual([])
  })

  test("a hard hint yields to an answer the human wrote, but not to the model", () => {
    const check = (answer: FormAnswer) =>
      validateAnswers(form, [valid[0]!, answer, valid[2]!], hints).map((error) => `${error.code}:${error.questionId}`)
    expect(check(ans("2", { text: "от 250000", source: "human" }))).toEqual([])
    expect(check(ans("2", { text: "от 250000", source: "model" }))).toEqual(["hard_hint_overridden:2"])
  })

  test("a hard hint with blockers yields to the user's own answer, and only to it", () => {
    const blocked = hints.map((hint) =>
      hint.questionId === "2" ? { ...hint, blockers: ["upper_bound_below_minimum"] as unknown as typeof hint.blockers } : hint
    )
    const check = (answer: FormAnswer) =>
      validateAnswers(form, [valid[0]!, answer, valid[2]!], blocked).map((error) => `${error.code}:${error.questionId}`)
    expect(check(ans("2", { text: "от 250000", source: "human" }))).toEqual([])
    expect(check(ans("2", { text: "от 250000", source: "model" }))).toEqual(["hard_hint_overridden:2"])
    expect(check(ans("2", { text: "от 250000", source: "human", needsHuman: true }))).toEqual(["hard_hint_overridden:2"])
  })

  test("option not on the form", () => {
    expect(codes([valid[0]!, valid[1]!, ans("4", { optionIds: ["zzz"] })])).toEqual(["unknown_option:4"])
  })

  test("several options on a single-choice question", () => {
    expect(codes([ans("1", { optionIds: ["y", "n"] }), valid[1]!, valid[2]!])).toContain("too_many_options:1")
  })

  test("answer for a question that is not on the form", () => {
    expect(codes([...valid, ans("99", { text: "x" })])).toEqual(["unknown_question:99"])
  })

  test("required unanswered: missing, empty text, needsHuman placeholder", () => {
    expect(codes([valid[1]!, valid[2]!])).toContain("required_unanswered:1")
    expect(codes([valid[0]!, ans("2", { text: "  ", needsHuman: true }), valid[2]!])).toContain("required_unanswered:2")
  })

  test("optional questions may stay empty", () => {
    expect(codes(valid)).not.toContain("required_unanswered:3")
  })

  test("salary without a number", () => {
    expect(codes([valid[0]!, ans("2", { text: "Обсудим на собеседовании" }), valid[2]!])).toEqual([
      "salary_without_number:2",
      "hard_hint_overridden:2"
    ])
  })

  test("text over maxLength", () => {
    expect(codes([...valid, ans("3", { text: "x".repeat(21) })])).toEqual(["text_too_long:3"])
  })

  test("banned style in free text", () => {
    expect(codes([...valid, ans("3", { text: "Опыт — большой!" })])).toEqual(["banned_style:3"])
    expect(codes([...valid, ans("3", { text: "Опыт 🚀" })])).toEqual(["banned_style:3"])
  })

  test("code answers are exempt from style rules", () => {
    expect(codes([...valid, ans("5", { text: "if (a != b) { return !a }" })])).toEqual([])
  })

  test("a soft hint can be rewritten freely", () => {
    const softForm = { questions: [yesNoQuestion("1", "Вы использовали Docker?")] }
    const softHints = answerHints({
      questions: softForm.questions,
      vacancy: { areaName: null, salaryFrom: null, salaryTo: null, salaryCurrency: null, workFormats: [] },
      salary: null,
      resumeWorkFormats: []
    })
    expect(softHints[0]?.hard).toBe(false)
    expect(validateAnswers(softForm, [ans("1", { optionIds: ["1-n"] })], softHints)).toEqual([])
  })

  test("reports every problem at once", () => {
    const errors = validateAnswers(form, [ans("1", { optionIds: ["n"] }), ans("2", { text: "много" }), ans("3", { text: "!" })], hints)
    expect(errors.map((error) => error.code).sort()).toEqual([
      "banned_style",
      "hard_hint_overridden",
      "hard_hint_overridden",
      "required_unanswered",
      "salary_without_number"
    ])
  })
})
