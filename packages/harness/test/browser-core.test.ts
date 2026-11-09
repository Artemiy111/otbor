import type { FormAnswer, SubmitJobPayload } from "@otbor/contract"
import { classifyResponsePage, isSubmitSuccess, parseResponseForm } from "@otbor/hh"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  fillPlan,
  negotiationsSyncExit,
  negotiationsUrl,
  postClickExit,
  prepareExit,
  reconcileExit,
  responseUrl,
  submitPreflight,
  vacancyUrl,
  wantsMoreNegotiations,
  wantsMoreSyncPages,
  chatUrl,
  bumpUnclicked,
  resumeBumpExit
} from "../src/browser/core.ts"
import { hhProfileDir, safeProfileName } from "../src/browser/profile.ts"

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")

const URL_OK = "https://hh.ru/applicant/vacancy_response?vacancyId=100500"
const html = fixture("hh-test-response.html")
const form = parseResponseForm(html, URL_OK)

const answer = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "human",
  hard: false,
  needsHuman: false,
  ...extra
})

const answers: ReadonlyArray<FormAnswer> = [
  answer("387049547", { optionIds: ["387049548"] }),
  answer("387049551", { optionIds: ["387049553"] }),
  answer("387049555", { text: "Москва" }),
  answer("387049556", { optionIds: ["387049557", "387049558"] }),
  answer("387049560", { text: "300000" })
]

const payload = (
  over: Partial<Pick<SubmitJobPayload, "expectedFormHash">> & {
    answers?: ReadonlyArray<FormAnswer>
  } = {}
): Pick<SubmitJobPayload, "expectedFormHash" | "kit"> => ({
  expectedFormHash: over.expectedFormHash ?? form.formHash,
  kit: { formHash: form.formHash, letter: "Здравствуйте", answers: over.answers ?? answers }
})

describe("prepareExit", () => {
  test("the response form becomes a prepared exit with the form fragment", () => {
    const exit = prepareExit(html, URL_OK)
    expect(exit.tag).toBe("prepared")
    const artifacts = exit.artifacts as { url: string; html: string }
    expect(artifacts.url).toBe(URL_OK)
    // The cloud parses the fragment and must reach the same form.
    expect(parseResponseForm(artifacts.html, URL_OK).formHash).toBe(form.formHash)
  })

  test("login, captcha, responded and archived pages are typed exits", () => {
    expect(prepareExit("<html></html>", "https://hh.ru/account/login?backurl=x").tag).toBe(
      "session_expired"
    )
    expect(prepareExit("<div>Подтвердите, что вы не робот</div>", URL_OK).tag).toBe("captcha")
    expect(
      prepareExit('<button data-qa="responded-success-attach-cover-letter"></button>', URL_OK).tag
    ).toBe("already_responded")
    expect(prepareExit("<h1>Вакансия в архиве</h1>", URL_OK).tag).toBe("vacancy_archived")
  })

  test("a relocation warning is reported, never confirmed, by prepare", () => {
    const exit = prepareExit('<button data-qa="relocation-warning-confirm">OK</button>', URL_OK)
    expect(exit.tag).toBe("relocation_warning")
  })

  test("an unrecognized page is blocked, not an empty form", () => {
    expect(prepareExit("<html><body>hello</body></html>", URL_OK).tag).toBe("blocked")
  })

  test("a responded page that still has the respond-again button is responded", () => {
    const page = `${html}<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>`
    expect(classifyResponsePage(page, URL_OK)).toBe("responded")
  })
})

describe("fillPlan", () => {
  test("maps answers to radios, checkboxes and textareas", () => {
    const plan = fillPlan(form, answers)
    expect(plan._tag).toBe("plan")
    if (plan._tag !== "plan") return
    expect(plan.steps).toHaveLength(6)
    expect(plan.steps[0]).toMatchObject({
      kind: "check",
      selector: 'input[name="task_387049547"][value="387049548"]'
    })
    expect(plan.steps.filter((step) => step.kind === "fill").map((step) => step.selector)).toEqual([
      'textarea[name="task_387049555_text"]',
      'textarea[name="task_387049560_text"]'
    ])
  })

  test("a required question without an answer aborts the plan", () => {
    const plan = fillPlan(form, answers.slice(0, 2))
    expect(plan).toMatchObject({ _tag: "missing", questionId: "387049555" })
  })

  test("an option the form does not offer aborts the plan", () => {
    const plan = fillPlan(form, [answer("387049547", { optionIds: ["1"] }), ...answers.slice(1)])
    expect(plan).toMatchObject({ _tag: "missing", questionId: "387049547" })
  })
})

describe("submitPreflight", () => {
  test("the form the kit was written for is filled", () => {
    const result = submitPreflight(payload(), html, URL_OK)
    expect(result._tag).toBe("fill")
  })

  test("a different form hash is form_changed and nothing is clicked", () => {
    const result = submitPreflight(payload({ expectedFormHash: "0000" }), html, URL_OK)
    expect(result._tag).toBe("exit")
    if (result._tag !== "exit") return
    expect(result.exit.tag).toBe("form_changed")
    expect(result.exit.formHash).toBe(form.formHash)
    expect(result.exit.artifacts).toMatchObject({ clicked: false })
  })

  test("a changed question text changes the hash", () => {
    const edited = html.replace("В каком городе проживаете?", "В какой стране проживаете?")
    const result = submitPreflight(payload(), edited, URL_OK)
    expect(result._tag === "exit" && result.exit.tag).toBe("form_changed")
  })

  test("an unreadable layout is form_changed, not an empty form", () => {
    const broken = `<form id="RESPONSE_MODAL_FORM_ID"><input type="hidden" name="testRequired" value="true"/></form>`
    const result = submitPreflight(payload(), broken, URL_OK)
    expect(result._tag === "exit" && result.exit.tag).toBe("form_changed")
  })

  test("login, captcha, responded and archived stop before any click", () => {
    const tags = (page: string, url = URL_OK) => {
      const result = submitPreflight(payload(), page, url)
      return result._tag === "exit" ? [result.exit.tag, result.exit.artifacts] : [result._tag]
    }
    expect(tags("", "https://hh.ru/account/login")[0]).toBe("session_expired")
    expect(tags("<div>Подтвердите, что вы не робот</div>")[0]).toBe("captcha")
    expect(tags("<div>Вы откликнулись</div>")[0]).toBe("already_responded")
    expect(tags("<h1>Вакансия в архиве</h1>")[0]).toBe("vacancy_archived")
    for (const page of ["<div>Вы откликнулись</div>", "<h1>Вакансия в архиве</h1>"]) {
      expect(tags(page)[1]).toMatchObject({ clicked: false })
    }
  })

  test("a relocation warning is handled by the executor, with a lease check first", () => {
    const result = submitPreflight(
      payload(),
      '<button data-qa="relocation-warning-confirm">OK</button>',
      URL_OK
    )
    expect(result._tag).toBe("relocation")
  })

  test("a missing required answer is answer_rejected before the click", () => {
    const result = submitPreflight(payload({ answers: answers.slice(0, 3) }), html, URL_OK)
    expect(result._tag === "exit" && result.exit.tag).toBe("answer_rejected")
  })
})

describe("postClickExit", () => {
  test("a responded page is submitted, with the evidence the cloud re-checks", () => {
    const page = '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'
    const exit = postClickExit(page, URL_OK, { letterAttached: true })
    expect(exit.tag).toBe("submitted")
    const evidence = exit.artifacts as { clicked: boolean; html: string; url: string }
    expect(evidence.clicked).toBe(true)
    expect(isSubmitSuccess(evidence.html, evidence.url)).toBe(true)
  })

  test("the form still showing after the click is ambiguous", () => {
    const exit = postClickExit(html, URL_OK)
    expect(exit.tag).toBe("ambiguous")
    expect(exit.artifacts).toMatchObject({ clicked: true, marker: "error" })
  })

  test("an unreadable page after the click is ambiguous with clicked: true", () => {
    const exit = postClickExit(null, URL_OK)
    expect(exit).toMatchObject({ tag: "ambiguous", artifacts: { clicked: true } })
  })

  test("a captcha after the click keeps clicked: true", () => {
    const exit = postClickExit("<div>Подтвердите, что вы не робот</div>", URL_OK)
    expect(exit).toMatchObject({ tag: "captcha", artifacts: { clicked: true, marker: "captcha" } })
  })
})

describe("profile paths", () => {
  test("a profile name is one path segment", () => {
    expect(safeProfileName("hh_123")).toBe("hh_123")
    expect(safeProfileName("../etc")).toBe("default")
    expect(safeProfileName("a/b")).toBe("default")
    expect(safeProfileName(null)).toBe("default")
    expect(hhProfileDir("x", { OTBOR_HH_PROFILES_DIR: "/tmp/p" })).toBe("/tmp/p/x")
  })

  test("the response URL carries the external id", () => {
    expect(responseUrl("https://hh.ru/", "42")).toBe(
      "https://hh.ru/applicant/vacancy_response?vacancyId=42"
    )
  })
})

describe("reconcileExit", () => {
  const vacancyPage = { url: "https://hh.ru/vacancy/100500", html: fixture("synthetic-vacancy-open.html") }
  const list = { url: "https://hh.ru/applicant/negotiations?page=0", html: fixture("synthetic-negotiations.html") }

  test("reports the pages it read as evidence and decides nothing", () => {
    const exit = reconcileExit("100500", { vacancy: vacancyPage, negotiations: [list] })
    expect(exit.tag).toBe("reconciled")
    const artifacts = exit.artifacts as { externalId: string; vacancy: { url: string }; negotiations: ReadonlyArray<{ html: string }> }
    expect(artifacts.externalId).toBe("100500")
    expect(artifacts.vacancy.url).toBe(vacancyPage.url)
    // Only the initial-state fragment travels for the list.
    expect(artifacts.negotiations[0]?.html.startsWith("<template")).toBe(true)
    expect(exit).not.toHaveProperty("clicked")
  })

  test("a login redirect or a captcha on any page is a typed exit", () => {
    const login = { url: "https://hh.ru/account/login?backurl=x", html: "<html></html>" }
    expect(reconcileExit("100500", { vacancy: login, negotiations: [] }).tag).toBe("session_expired")
    expect(reconcileExit("100500", { vacancy: vacancyPage, negotiations: [login] }).tag).toBe("session_expired")
    const captcha = { url: "https://hh.ru/captcha", html: "<html></html>" }
    expect(reconcileExit("100500", { vacancy: captcha, negotiations: [] }).tag).toBe("captcha")
  })

  test("urls and the paging rule", () => {
    expect(vacancyUrl("https://hh.ru/", "42")).toBe("https://hh.ru/vacancy/42")
    expect(negotiationsUrl("https://hh.ru", 3)).toBe("https://hh.ru/applicant/negotiations?page=3")
    expect(wantsMoreNegotiations(list.html, "999")).toBe(true)
    expect(wantsMoreNegotiations(list.html, "100500")).toBe(false)
    // A topic of another resume on the same vacancy does not stop the reading.
    expect(wantsMoreNegotiations(list.html, "100500", undefined, "no-such-resume")).toBe(true)
    expect(wantsMoreNegotiations(fixture("synthetic-negotiations-empty.html"), "1")).toBe(false)
    expect(wantsMoreNegotiations("<html></html>", "1")).toBe(false)
  })
})

describe("negotiations sync", () => {
  const detailed = fixture("synthetic-negotiations-detailed.html")
  const empty = fixture("synthetic-negotiations-empty.html")

  test("reads on while hh reports more pages, stops at the last or an empty one", () => {
    // The detailed fixture reports three pages.
    expect(wantsMoreSyncPages(detailed, 0)).toBe(true)
    expect(wantsMoreSyncPages(detailed, 1)).toBe(true)
    expect(wantsMoreSyncPages(detailed, 2)).toBe(false)
    expect(wantsMoreSyncPages(empty, 0)).toBe(false)
    expect(wantsMoreSyncPages("<html></html>", 0)).toBe(false)
    // No page count: keep going until an empty page.
    expect(wantsMoreSyncPages(fixture("synthetic-negotiations.html"), 4)).toBe(true)
  })

  test("a reconcile reads to the last page hh reports, not to a fixed limit", () => {
    // Вакансии, которой нет в списке: чтение идёт дальше, пока hh говорит, что страницы есть.
    expect(wantsMoreNegotiations(detailed, "no-such-vacancy", 0)).toBe(true)
    expect(wantsMoreNegotiations(detailed, "no-such-vacancy", 1)).toBe(true)
    expect(wantsMoreNegotiations(detailed, "no-such-vacancy", 2)).toBe(false)
    expect(wantsMoreNegotiations(empty, "no-such-vacancy", 0)).toBe(false)
  })

  test("reports the pages as untouched evidence, trimmed to the initial state", () => {
    const exit = negotiationsSyncExit([
      { url: "https://hh.ru/applicant/negotiations?page=0", html: detailed }
    ])
    expect(exit.tag).toBe("reconciled")
    const pages = (exit.artifacts as { pages: ReadonlyArray<{ html: string }> }).pages
    expect(pages).toHaveLength(1)
    expect(pages[0]!.html.startsWith("<template")).toBe(true)
  })

  test("a login redirect is reported as an expired session", () => {
    const exit = negotiationsSyncExit([
      { url: "https://hh.ru/account/login", html: "<html><body>login</body></html>" }
    ])
    expect(exit.tag).toBe("session_expired")
  })
})

describe("chatUrl", () => {
  test("opens the chat of one response", () => {
    expect(chatUrl("https://hh.ru/", "5770068788")).toBe("https://hh.ru/chat/5770068788")
  })
})

describe("подъём резюме: выходы харнесса", () => {
  const base = {
    clicked: true,
    label: "Поднять в поиске",
    lastBumpBefore: "08 ноября в 19:15",
    url: "https://hh.ru/resume/abc"
  }

  test("строка «Последнее» изменилась: submitted", () => {
    const exit = resumeBumpExit({ ...base, lastBumpAfter: "09 ноября в 23:40" })
    expect(exit.tag).toBe("submitted")
    expect(exit.artifacts?.clicked).toBe(true)
  })

  test("кнопка стала недоступной при той же строке: тоже submitted", () => {
    expect(resumeBumpExit({ ...base, lastBumpAfter: base.lastBumpBefore, unavailableAfter: true }).tag).toBe(
      "submitted"
    )
  })

  test("нажали, а карточка не изменилась: ambiguous, без повторного нажатия", () => {
    expect(resumeBumpExit({ ...base, lastBumpAfter: base.lastBumpBefore }).tag).toBe("ambiguous")
  })

  test("недоступная кнопка: blocked с clicked=false и подписью", () => {
    const exit = bumpUnclicked(base.url, "blocked", "bump not available: Поднимать автоматически", {
      label: "Поднимать автоматически",
      lastBump: base.lastBumpBefore
    })
    expect(exit.tag).toBe("blocked")
    expect(exit.artifacts).toMatchObject({ clicked: false, label: "Поднимать автоматически" })
  })
})
