import type { FormAnswer, HarnessExit, ResponseForm, StoredHint } from "@otbor/contract"
import { parseResponseForm } from "@otbor/hh"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkKit, judgeLetterAttach, judgeNegotiationsSync, judgeResumeBump, judgeReconcile, judgePrepare, judgeSubmit, toFormAnswers } from "../src/services/applyRules.ts"

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")

const URL_OK = "https://hh.ru/applicant/vacancy_response?vacancyId=100500"
const responseHtml = fixture("hh-test-response.html")
const codeHtml = fixture("hh-test-code.html")

const form: ResponseForm = parseResponseForm(responseHtml, URL_OK)
const codeForm: ResponseForm = parseResponseForm(codeHtml, URL_OK)

const answer = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "human",
  hard: false,
  needsHuman: false,
  ...extra
})

/** A complete, valid answer set for the response fixture. */
const fullAnswers = (): ReadonlyArray<FormAnswer> => [
  answer("387049547", { optionIds: ["387049548"] }),
  answer("387049551", { optionIds: ["387049553"] }),
  answer("387049555", { text: "Москва" }),
  answer("387049556", { optionIds: ["387049558"] }),
  answer("387049560", { text: "300000 рублей" })
]

const kitFor = (target: ResponseForm, answers: ReadonlyArray<FormAnswer>, letter = "Письмо") => ({
  formHash: target.formHash,
  letter,
  answers
})

describe("checkKit", () => {
  test("the fixture parses as a known form with five questions", () => {
    expect(form.layout).toBe("known")
    expect(form.questions).toHaveLength(5)
  })

  test("a complete human kit has no problems", () => {
    expect(checkKit({ form, hints: [], kit: kitFor(form, fullAnswers()) })).toEqual([])
  })

  test("a kit written for another form is refused with form_changed", () => {
    const problems = checkKit({
      form,
      hints: [],
      kit: { formHash: "deadbeef", letter: "x", answers: fullAnswers() }
    })
    expect(problems.map((problem) => problem.code)).toEqual(["form_changed"])
  })

  test("an unreadable layout is never auto-approved", () => {
    const unknown = parseResponseForm("<html></html>", URL_OK)
    expect(unknown.layout).toBe("unknown")
    const problems = checkKit({ form: unknown, hints: [], kit: kitFor(unknown, []) })
    expect(problems.map((problem) => problem.code)).toEqual(["form_unreadable"])
  })

  test("required questions left unanswered are reported", () => {
    const problems = checkKit({
      form,
      hints: [],
      kit: kitFor(form, [answer("387049547", { optionIds: ["387049548"] })])
    })
    expect(problems.filter((problem) => problem.code === "required_unanswered")).toHaveLength(4)
  })

  test("a hard hint that was changed is refused", () => {
    const hint: StoredHint = {
      questionId: "387049555",
      kind: "city",
      text: "Казань",
      hard: true,
      confidence: 1,
      note: null,
      evidence: [],
      blockers: []
    }
    const answers = fullAnswers().map((item) =>
      item.questionId === "387049555" ? { ...item, text: "Москва", source: "model" as const } : item
    )
    const problems = checkKit({ form, hints: [hint], kit: kitFor(form, answers) })
    expect(problems.map((problem) => problem.code)).toContain("hard_hint_overridden")

    // Человек вправе перекрыть жёсткую подсказку: его ответ не блокируется.
    const byHuman = answers.map((item) =>
      item.questionId === "387049555" ? { ...item, source: "human" as const } : item
    )
    expect(checkKit({ form, hints: [hint], kit: kitFor(form, byHuman) })).toEqual([])

    const kept = fullAnswers().map((item) =>
      item.questionId === "387049555" ? { ...item, text: "Казань" } : item
    )
    expect(checkKit({ form, hints: [hint], kit: kitFor(form, kept) })).toEqual([])
  })

  test("a model answer flagged needsHuman is not enough", () => {
    const answers = fullAnswers().map((item) =>
      item.questionId === "387049560"
        ? { ...item, source: "model" as const, needsHuman: true }
        : item
    )
    const problems = checkKit({ form, hints: [], kit: kitFor(form, answers) })
    expect(problems.map((problem) => problem.code)).toContain("needs_human")
  })

  test("a code question is answered like any other, by a model too", () => {
    const question = codeForm.questions.find((item) => item.kind === "code")!
    const other = codeForm.questions.find((item) => item.kind !== "code")!
    const problems = checkKit({
      form: codeForm,
      hints: [],
      kit: kitFor(codeForm, [
        answer(other.id, { text: "5" }),
        answer(question.id, { text: "def f(): pass", source: "model" })
      ])
    })
    expect(problems.map((problem) => problem.code)).not.toContain("code_needs_human")
  })

  test("a blocked hint needs a human answer", () => {
    const hint: StoredHint = {
      questionId: "387049560",
      kind: "salary",
      hard: false,
      confidence: 0.5,
      note: null,
      evidence: [],
      blockers: ["upper_bound_below_minimum"]
    }
    const byModel = fullAnswers().map((item) =>
      item.questionId === "387049560" ? { ...item, source: "model" as const } : item
    )
    expect(
      checkKit({ form, hints: [hint], kit: kitFor(form, byModel) }).map((problem) => problem.code)
    ).toContain("hint_blocked")
    expect(checkKit({ form, hints: [hint], kit: kitFor(form, fullAnswers()) })).toEqual([])
  })

  test("a required cover letter must be present", () => {
    const needsLetter: ResponseForm = { ...form, coverLetter: "required" }
    const problems = checkKit({ form: needsLetter, hints: [], kit: kitFor(needsLetter, fullAnswers(), " ") })
    expect(problems.map((problem) => problem.code)).toEqual(["letter_required"])
  })

  test("a cover letter that breaks the house style fails the kit", () => {
    const needsLetter: ResponseForm = { ...form, coverLetter: "optional" }
    const problems = checkKit({ form: needsLetter, hints: [], kit: kitFor(needsLetter, fullAnswers(), "Здравствуйте — готов!") })
    expect(problems.map((problem) => problem.code)).toEqual(["banned_style"])
  })

  test("an exclamation mark in the cover letter is not a schema error", () => {
    const needsLetter: ResponseForm = { ...form, coverLetter: "optional" }
    expect(checkKit({ form: needsLetter, hints: [], kit: kitFor(needsLetter, fullAnswers(), "Здравствуйте!") })).toEqual([])
  })

  test("legacy question/answer pairs are matched by text and option label", () => {
    const converted = toFormAnswers(form, [
      { question: "Вы имеете оконченное ТЕХНИЧЕСКОЕ высшее образование?", answer: "Да" },
      { question: "В каком городе проживаете?", answer: "Москва" },
      { question: "A question that is not on the form", answer: "?" }
    ])
    expect(converted[0]).toMatchObject({ questionId: "387049547", optionIds: ["387049548"] })
    expect(converted[1]).toMatchObject({ questionId: "387049555", text: "Москва" })
    expect(converted[2]).toMatchObject({ questionId: "A question that is not on the form" })
  })
})

const evidence = (over: Record<string, unknown> = {}) => ({
  clicked: true,
  url: URL_OK,
  marker: "success",
  html: '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>',
  ...over
})

describe("judgeSubmit", () => {
  test("a responded page after the click is submitted", () => {
    const verdict = judgeSubmit({ tag: "submitted", artifacts: evidence() })
    expect(verdict._tag).toBe("submitted")
  })

  test("the harness saying submitted without evidence is reconcile", () => {
    expect(judgeSubmit({ tag: "submitted" })._tag).toBe("reconcile")
    expect(judgeSubmit({ tag: "clicked" })._tag).toBe("reconcile")
  })

  test("success marker claimed but the html is just the form is reconcile", () => {
    const verdict = judgeSubmit({
      tag: "submitted",
      artifacts: evidence({ html: '<form id="RESPONSE_MODAL_FORM_ID"><button data-qa="vacancy-response-submit-popup">Откликнуться</button></form>' })
    })
    expect(verdict._tag).toBe("reconcile")
  })

  test("clicked: false cannot be combined with submitted", () => {
    expect(judgeSubmit({ tag: "submitted", artifacts: evidence({ clicked: false }) })._tag).toBe(
      "reconcile"
    )
  })

  test("ambiguous and timeouts after a click go to reconcile", () => {
    expect(judgeSubmit({ tag: "ambiguous", artifacts: evidence({ marker: "none" }) })._tag).toBe(
      "reconcile"
    )
    expect(judgeSubmit({ tag: "transport", artifacts: evidence({ marker: "none" }) })._tag).toBe(
      "reconcile"
    )
    expect(judgeSubmit({ tag: "captcha", artifacts: evidence({ marker: "captcha" }) })._tag).toBe(
      "reconcile"
    )
  })

  test("form_changed with clicked: false is provably unsent", () => {
    const exit: HarnessExit = {
      tag: "form_changed",
      artifacts: { clicked: false, url: URL_OK, marker: "none" }
    }
    const verdict = judgeSubmit(exit)
    expect(verdict).toMatchObject({ _tag: "not_sent", app: "needs_human" })
  })

  test("a pre-click tag without evidence is not believed", () => {
    expect(judgeSubmit({ tag: "form_changed" })._tag).toBe("reconcile")
    expect(judgeSubmit({ tag: "session_expired" })._tag).toBe("reconcile")
  })

  test("a pre-click tag with clicked: true is not believed either", () => {
    expect(
      judgeSubmit({ tag: "form_changed", artifacts: evidence({ marker: "none" }) })._tag
    ).toBe("reconcile")
  })

  test("already_responded is checked by reconcile, not trusted", () => {
    expect(
      judgeSubmit({
        tag: "already_responded",
        artifacts: { clicked: false, url: URL_OK, marker: "none" }
      })._tag
    ).toBe("reconcile")
  })
})

describe("judgePrepare", () => {
  const prepared = (html: string, url = URL_OK): HarnessExit => ({
    tag: "prepared",
    artifacts: { url, html }
  })

  test("a form page is accepted", () => {
    expect(judgePrepare(prepared(responseHtml))._tag).toBe("form")
  })

  test("prepared is only believed after the cloud classified the page", () => {
    expect(judgePrepare(prepared("<html>Войдите</html>", "https://hh.ru/account/login"))).toMatchObject({
      _tag: "human"
    })
    expect(judgePrepare(prepared("<div>Вы откликнулись</div>"))._tag).toBe("skip")
    expect(judgePrepare(prepared("<div>Вакансия в архиве</div>"))._tag).toBe("skip")
    expect(judgePrepare(prepared("<html></html>"))._tag).toBe("human")
    expect(judgePrepare({ tag: "prepared" })._tag).toBe("human")
  })

  test("typed exits map to human, skip or retry", () => {
    expect(judgePrepare({ tag: "session_expired" })._tag).toBe("human")
    expect(judgePrepare({ tag: "captcha" })._tag).toBe("human")
    expect(judgePrepare({ tag: "relocation_warning" })._tag).toBe("human")
    expect(judgePrepare({ tag: "vacancy_archived" })._tag).toBe("skip")
    expect(judgePrepare({ tag: "already_responded" })._tag).toBe("skip")
    expect(judgePrepare({ tag: "transport" })._tag).toBe("retry")
    expect(judgePrepare({ tag: "permanent" })._tag).toBe("failed")
  })
})


describe("judgeLetterAttach", () => {
  const artifacts = (clicked: boolean, closed: boolean) => ({ clicked, closed, url: URL_OK })

  test("sent only when the harness clicked and the dialog closed", () => {
    expect(judgeLetterAttach({ tag: "submitted", artifacts: artifacts(true, true) })._tag).toBe("sent")
  })

  test("a click that may have reached hh is left to a human, never retried", () => {
    expect(judgeLetterAttach({ tag: "ambiguous", artifacts: artifacts(true, false) })._tag).toBe("human")
    expect(judgeLetterAttach({ tag: "submitted", artifacts: artifacts(true, false) })._tag).toBe("human")
  })

  test("missing evidence counts as a possible click", () => {
    expect(judgeLetterAttach({ tag: "transport" })._tag).toBe("human")
    expect(judgeLetterAttach({ tag: "submitted" })._tag).toBe("human")
  })

  test("an unclicked exit is a plain failure", () => {
    expect(judgeLetterAttach({ tag: "not_submitted", artifacts: artifacts(false, false) })._tag).toBe("failed")
    expect(judgeLetterAttach({ tag: "session_expired", artifacts: artifacts(false, false) })._tag).toBe("failed")
  })
})

describe("judgeNegotiationsSync", () => {
  test("keeps one topic per vacancy and resume, each with its own chat", () => {
    const topic = (chatId: number, resumeId: number) => ({
      chatId,
      vacancyId: 138673985,
      resumeId,
      lastState: "RESPONSE",
      lastModified: "2026-11-05T18:56:12.847+03:00"
    })
    const state = JSON.stringify({
      applicantNegotiations: {
        topicList: [topic(5770068788, 290733333), topic(5732439170, 289972366), topic(1, 290733333)],
        pageCount: "1"
      }
    })
    const exit: HarnessExit = {
      tag: "reconciled",
      artifacts: {
        pages: [
          {
            url: "https://hh.ru/applicant/negotiations?page=0",
            html: `<template id="HH-Lux-InitialState">${state}</template>`
          }
        ]
      }
    }
    const verdict = judgeNegotiationsSync(exit)
    expect(verdict._tag).toBe("read")
    if (verdict._tag !== "read") return
    // The repeated (vacancy, resume) pair is the older entry of the same response.
    expect(verdict.topics.map((item) => [item.resumeId, item.chatId])).toEqual([
      ["290733333", "5770068788"],
      ["289972366", "5732439170"]
    ])
  })
})

describe("judgeReconcile with two resumes", () => {
  const page = (topics: ReadonlyArray<object>) => ({
    url: "https://hh.ru/applicant/negotiations?page=0",
    html: `<template id="HH-Lux-InitialState">${JSON.stringify({
      applicantNegotiations: { topicList: topics, pageCount: "2" }
    })}</template>`
  })
  const topic = (resumeId: number) => ({
    chatId: 1000 + resumeId,
    vacancyId: 138177094,
    resumeId,
    lastState: "RESPONSE"
  })
  const exitFor = (topics: ReadonlyArray<object>): HarnessExit => ({
    tag: "reconciled",
    artifacts: { externalId: "138177094", negotiations: [page(topics), page([])] }
  })

  test("a response made with another resume does not settle this one", () => {
    const verdict = judgeReconcile(exitFor([topic(290733333)]), "138177094", "289972366")
    expect(verdict._tag).not.toBe("submitted")
  })

  test("the topic of the application's own resume does", () => {
    const verdict = judgeReconcile(exitFor([topic(290733333), topic(289972366)]), "138177094", "289972366")
    expect(verdict._tag).toBe("submitted")
  })

  test("without a known resume any topic of the vacancy still counts", () => {
    const verdict = judgeReconcile(exitFor([topic(290733333)]), "138177094")
    expect(verdict._tag).toBe("submitted")
  })
})

describe("judgeResumeBump", () => {
  const evidence = (extra: Record<string, unknown>) => ({
    clicked: true,
    label: "Поднять в поиске",
    lastBumpBefore: "08 ноября в 19:15",
    lastBumpAfter: "09 ноября в 23:40",
    url: "https://hh.ru/resume/x",
    ...extra
  })

  test("нажатие и изменившаяся строка: подъём состоялся", () => {
    const verdict = judgeResumeBump({ tag: "submitted", artifacts: evidence({}) })
    expect(verdict._tag).toBe("bumped")
  })

  test("нажатие, кнопка пропала при той же строке: подъём состоялся", () => {
    const verdict = judgeResumeBump({
      tag: "submitted",
      artifacts: evidence({ lastBumpAfter: "08 ноября в 19:15", unavailableAfter: true })
    })
    expect(verdict._tag).toBe("bumped")
  })

  test("тег submitted не решает: без нажатия в свидетельстве подъёма нет", () => {
    const verdict = judgeResumeBump({ tag: "submitted", artifacts: evidence({ clicked: false }) })
    expect(verdict._tag).toBe("retry")
  })

  test("нажатие без изменения карточки: unconfirmed", () => {
    const verdict = judgeResumeBump({
      tag: "ambiguous",
      artifacts: evidence({ lastBumpAfter: "08 ноября в 19:15" })
    })
    expect(verdict._tag).toBe("unconfirmed")
  })

  test("ambiguous без свидетельства: unconfirmed, а не повтор", () => {
    expect(judgeResumeBump({ tag: "ambiguous" })._tag).toBe("unconfirmed")
  })

  test("недоступная кнопка: unavailable", () => {
    const verdict = judgeResumeBump({
      tag: "blocked",
      artifacts: evidence({ clicked: false, label: "Поднимать автоматически", lastBumpAfter: "08 ноября в 19:15" })
    })
    expect(verdict).toEqual({
      _tag: "unavailable",
      label: "Поднимать автоматически",
      lastBump: "08 ноября в 19:15"
    })
  })

  test("сессия и капча требуют человека, сеть - повтор", () => {
    expect(judgeResumeBump({ tag: "session_expired" })._tag).toBe("human")
    expect(judgeResumeBump({ tag: "captcha" })._tag).toBe("human")
    expect(judgeResumeBump({ tag: "transport", message: "timeout" })._tag).toBe("retry")
  })
})
