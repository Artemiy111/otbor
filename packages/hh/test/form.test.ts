import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { formHashOf, parseResponseForm, readVacancyTest } from "../src/form.ts"

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")

const URL_OF = "https://hh.ru/applicant/vacancy_response?vacancyId=123456789"

describe("parseResponseForm: the documented layout", () => {
  const form = parseResponseForm(fixture("hh-test-response.html"), URL_OF)

  test("reads vacancy id, layout and all questions in page order", () => {
    expect(form.vacancyId).toBe("123456789")
    expect(form.layout).toBe("known")
    expect(form.questions.map((question) => question.id)).toEqual([
      "387049547",
      "387049551",
      "387049555",
      "387049556",
      "387049560"
    ])
  })

  test("radios are single, checkboxes multiple, textareas text", () => {
    expect(form.questions.map((question) => question.kind)).toEqual([
      "single",
      "single",
      "text",
      "multiple",
      "text"
    ])
  })

  test("options carry the input value as id and the label text", () => {
    expect(form.questions[0]?.options).toEqual([
      { id: "387049548", label: "Да" },
      { id: "387049549", label: "Нет" },
      { id: "387049550", label: "Да (не техническое)" }
    ])
    expect(form.questions[3]?.options[2]).toEqual({ id: "387049559", label: "Нет (только удаленно)" })
  })

  test("testRequired=true makes every task required", () => {
    expect(form.questions.every((question) => question.required)).toBe(true)
  })

  test("the question text is clean", () => {
    expect(form.questions[0]?.text).toBe("Вы имеете оконченное ТЕХНИЧЕСКОЕ высшее образование?")
  })

  test("no letter field on this form", () => {
    expect(form.coverLetter).toBe("absent")
  })
})

describe("parseResponseForm: code tasks", () => {
  const form = parseResponseForm(fixture("hh-test-code.html"), URL_OF)

  test("an editor block is a code question with its language", () => {
    expect(form.layout).toBe("known")
    expect(form.questions[0]).toMatchObject({
      id: "900000001",
      kind: "code",
      codeLanguage: "python"
    })
  })

  test("a plain textarea next to it stays text", () => {
    expect(form.questions[1]).toMatchObject({ id: "900000002", kind: "text", codeLanguage: null })
  })

  test("without testRequired nothing is marked required", () => {
    expect(form.questions.some((question) => question.required)).toBe(false)
  })
})

describe("parseResponseForm: markup variations", () => {
  const wrap = (body: string, extra = ""): string =>
    `<form id="RESPONSE_MODAL_FORM_ID">${body}${extra}<button data-qa="vacancy-response-submit-popup">Ok</button></form>`

  test("required via attribute, asterisk and maxlength", () => {
    const html = wrap(`
      <div data-qa="task-body"><div data-qa="task-question">Расскажите о себе *</div>
        <textarea name="task_11_text" maxlength="500"></textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Ваш город?</div>
        <textarea name="task_12_text" required></textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Необязательно</div>
        <textarea name="task_13_text"></textarea></div>`)
    const form = parseResponseForm(html, URL_OF)
    expect(form.questions.map((question) => question.required)).toEqual([true, true, false])
    expect(form.questions[0]).toMatchObject({ text: "Расскажите о себе", maxLength: 500 })
  })

  test("labels by for=, aria-label and entities", () => {
    const html = wrap(`
      <div data-qa="task-body"><div data-qa="task-question">Выберите &laquo;вариант&raquo;</div>
        <input type="radio" id="a" name="task_21" value="1"><label for="a">Первый</label>
        <input type="radio" name="task_21" value="2" aria-label="Второй">
      </div>`)
    const [question] = parseResponseForm(html, URL_OF).questions
    expect(question?.text).toBe("Выберите «вариант»")
    expect(question?.options).toEqual([
      { id: "1", label: "Первый" },
      { id: "2", label: "Второй" }
    ])
  })

  test("select becomes single choice and skips the empty placeholder", () => {
    const html = wrap(`
      <div data-qa="task-body"><div data-qa="task-question">Уровень</div>
        <select name="task_31"><option value="">Выберите</option><option value="7">Junior</option><option value="8">Middle</option></select>
      </div>`)
    expect(parseResponseForm(html, URL_OF).questions[0]).toMatchObject({
      id: "31",
      kind: "single",
      options: [
        { id: "7", label: "Junior" },
        { id: "8", label: "Middle" }
      ]
    })
  })

  test("disabled and hidden controls are ignored", () => {
    const html = wrap(`
      <div data-qa="task-body"><div data-qa="task-question">Q</div>
        <label><input type="radio" name="task_41" value="1">Да</label>
        <label><input type="radio" name="task_41" value="2" disabled>Нет</label>
      </div>`)
    expect(parseResponseForm(html, URL_OF).questions[0]?.options).toEqual([{ id: "1", label: "Да" }])
  })

  test("the cover letter textarea after the tasks is not part of the last question", () => {
    const html = wrap(
      `<div data-qa="task-body"><div data-qa="task-question">Q</div><textarea name="task_51_text"></textarea></div>`,
      `<textarea data-qa="vacancy-response-popup-form-letter-input" name="letter"></textarea>`
    )
    const form = parseResponseForm(html, URL_OF)
    expect(form.questions).toHaveLength(1)
    expect(form.questions[0]?.id).toBe("51")
    expect(form.coverLetter).toBe("optional")
  })

  test("cover letter: required attribute, toggle, absent", () => {
    const required = wrap("", `<textarea name="letter" required></textarea>`)
    const toggle = wrap("", `<button data-qa="vacancy-response-letter-toggle">Добавить</button>`)
    expect(parseResponseForm(required, URL_OF).coverLetter).toBe("required")
    expect(parseResponseForm(toggle, URL_OF).coverLetter).toBe("optional")
    expect(parseResponseForm(wrap(""), URL_OF).coverLetter).toBe("absent")
  })

  test("cover letter: required by the page state or by hh's form error, not by the textarea", () => {
    // Живая страница: поле без `required`, обязательность лежит в состоянии вакансии.
    const field = `<textarea data-qa="vacancy-response-popup-form-letter-input" name="letter"></textarea>`
    const state = (required: boolean) =>
      `<template id="HH-Lux-InitialState">{"vacancyView":{"responseLetterRequired":${required}}}</template>`
    expect(parseResponseForm(wrap("", field + state(true)), URL_OF).coverLetter).toBe("required")
    expect(parseResponseForm(wrap("", field + state(false)), URL_OF).coverLetter).toBe("optional")
    const error = `<div class="vacancy-response-error" data-qa-popup-error-code="letter-required">Пожалуйста, введите сопроводительное письмо</div>`
    expect(parseResponseForm(wrap("", field + error), URL_OF).coverLetter).toBe("required")
  })

  test("vacancy id falls back to the form input, then /vacancy/ URLs", () => {
    const html = wrap(`<input type="hidden" name="vacancyId" value="777">`)
    expect(parseResponseForm(html, "https://hh.ru/applicant/vacancy_response").vacancyId).toBe("777")
    expect(parseResponseForm(wrap(""), "https://hh.ru/vacancy/555").vacancyId).toBe("555")
  })

  test("a form without tasks and without a test is a known empty form", () => {
    const form = parseResponseForm(wrap(""), URL_OF)
    expect(form.layout).toBe("known")
    expect(form.questions).toEqual([])
  })

  test("a natural-language code task without an editor is still code", () => {
    const html = wrap(`<div data-qa="task-body"><div data-qa="task-question">Напишите функцию на Go, которая разворачивает строку</div><textarea name="task_61_text"></textarea></div>`)
    expect(parseResponseForm(html, URL_OF).questions[0]).toMatchObject({ kind: "code", codeLanguage: "go" })
  })

  test("an open question that merely says 'напишите' is not code", () => {
    const html = wrap(`<div data-qa="task-body"><div data-qa="task-question">Напишите, почему вам интересна вакансия</div><textarea name="task_62_text"></textarea></div>`)
    expect(parseResponseForm(html, URL_OF).questions[0]?.kind).toBe("text")
  })
})

describe("parseResponseForm: unknown layouts are never silent", () => {
  test("a page with no form at all", () => {
    const form = parseResponseForm("<html><body>captcha</body></html>", URL_OF)
    expect(form).toMatchObject({ layout: "unknown", questions: [], vacancyId: "123456789" })
  })

  test("a test is declared but no tasks match the selectors", () => {
    const html = `<form id="RESPONSE_MODAL_FORM_ID"><input type="hidden" name="testRequired" value="true"><div class="new-task">Q</div></form>`
    expect(parseResponseForm(html, URL_OF).layout).toBe("unknown")
  })

  test("one unreadable task poisons the whole form", () => {
    const html = `<form id="RESPONSE_MODAL_FORM_ID">
      <div data-qa="task-body"><div data-qa="task-question">Ok</div><textarea name="task_1_text"></textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Widget</div><div class="custom-widget"></div></div>
    </form>`
    const form = parseResponseForm(html, URL_OF)
    expect(form.layout).toBe("unknown")
    expect(form.questions).toEqual([])
  })

  test("a task without question text is unknown", () => {
    const html = `<form id="RESPONSE_MODAL_FORM_ID"><div data-qa="task-body"><textarea name="task_1_text"></textarea></div></form>`
    expect(parseResponseForm(html, URL_OF).layout).toBe("unknown")
  })
})

describe("formHash", () => {
  const html = fixture("hh-test-response.html")

  test("is deterministic", () => {
    expect(parseResponseForm(html, URL_OF).formHash).toBe(parseResponseForm(html, URL_OF).formHash)
    expect(parseResponseForm(html, URL_OF).formHash).toMatch(/^[0-9a-f]{16}$/)
  })

  test("ignores whitespace, case and markup noise", () => {
    const noisy = html
      .replace("ТЕХНИЧЕСКОЕ", "  техническое ")
      .replace(/<input type="hidden" name="guid"[^>]*>/, "")
    expect(parseResponseForm(noisy, URL_OF).formHash).toBe(parseResponseForm(html, URL_OF).formHash)
  })

  test("changes with question text, option label and option id", () => {
    const base = parseResponseForm(html, URL_OF).formHash
    expect(parseResponseForm(html.replace("В каком городе", "В каком регионе"), URL_OF).formHash).not.toBe(base)
    expect(parseResponseForm(html.replace(">ГПХ<", ">ГПХ/ИП<"), URL_OF).formHash).not.toBe(base)
    expect(parseResponseForm(html.replace('value="387049553"', 'value="999"'), URL_OF).formHash).not.toBe(base)
  })

  test("is order-sensitive", () => {
    const form = parseResponseForm(html, URL_OF)
    const swapped = [form.questions[1]!, form.questions[0]!, ...form.questions.slice(2)]
    expect(formHashOf(swapped)).not.toBe(formHashOf(form.questions))
  })

  test("does not depend on the url", () => {
    expect(parseResponseForm(html, "https://hh.ru/applicant/vacancy_response?vacancyId=1").formHash).toBe(
      parseResponseForm(html, URL_OF).formHash
    )
  })
})

describe("readVacancyTest", () => {
  const page = (statuses: unknown): string =>
    `<template id="HH-Lux-InitialState">${JSON.stringify({ applicantVacancyResponseStatuses: statuses })}</template>`

  test("hasTests with required flag", () => {
    expect(readVacancyTest(page({ "42": { test: { hasTests: true, testId: 9, required: true } } }), "42")).toEqual({
      hasTest: true,
      required: true,
      testId: "9"
    })
  })

  test("optional test", () => {
    expect(readVacancyTest(page({ "42": { test: { hasTests: true, required: false } } }), "42")).toMatchObject({
      hasTest: true,
      required: false
    })
  })

  test("falls back to shortVacancy.userTestPresent, required unknown", () => {
    expect(readVacancyTest(page({ "42": { shortVacancy: { userTestPresent: true, userTestId: "5" } } }), "42")).toEqual({
      hasTest: true,
      required: null,
      testId: "5"
    })
  })

  test("no test, other vacancy, missing state", () => {
    const none = { hasTest: false, required: null, testId: null }
    expect(readVacancyTest(page({ "42": { test: { hasTests: false } } }), "42")).toEqual(none)
    expect(readVacancyTest(page({ "7": { test: { hasTests: true } } }), "42")).toEqual(none)
    expect(readVacancyTest("<html></html>", "42")).toEqual(none)
  })
})
