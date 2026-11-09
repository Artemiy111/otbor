import type { FormAnswer, SubmitJobPayload } from "@otbor/contract"
import { isSubmitSuccess, parseNegotiations, parseResponseForm, readResponseStatus } from "@otbor/hh"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { makePlaywrightExecutor } from "../src/browser/playwright.ts"

/**
 * Real Chromium against a local server that imitates the hh response page.
 * Nothing here touches hh.ru or a real Chrome profile: the executor is pointed
 * at 127.0.0.1 and a temporary profile root. Skipped when Playwright's
 * Chromium is not installed (`bunx playwright install chromium`).
 */

const hasBrowser = (() => {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
})()

const base = readFileSync(
  join(import.meta.dir, "../../hh/test/fixtures/hh-test-response.html"),
  "utf8"
)

const SCRIPT = `
<script>
  const form = document.getElementById('RESPONSE_MODAL_FORM_ID');
  const button = form.querySelector('[data-qa=vacancy-response-submit-popup]');
  const refresh = () => {
    const names = new Set([...form.querySelectorAll('input[type=radio],input[type=checkbox]')].map((i) => i.name));
    let ok = true;
    for (const name of names) {
      if (![...form.querySelectorAll('input[name="' + name + '"]')].some((i) => i.checked)) ok = false;
    }
    for (const t of form.querySelectorAll('textarea[name^=task_]')) if (!t.value.trim()) ok = false;
    button.disabled = !ok;
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    params.set('resume', window.__resume || '');
    await fetch('/respond', { method: 'POST', body: params });
    if (!window.__silent) {
      document.body.innerHTML = '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>';
    }
  });
</script>`

const HASH_A = "aaaa00000000000000000000000000000000aa01"
const HASH_B = "bbbb00000000000000000000000000000000bb02"

/**
 * Селект резюме по форме реальной страницы: карточка `resume-title`, клик
 * открывает список `label[role=option]` с хэшем, выбор закрывает (размонтирует) его.
 * Резюме 1001 (хэш A) выбрано заранее, 1002 (хэш B) предлагается; 1003 страница не знает.
 */
const resumeWidget = (opts: { slow?: boolean; broken?: boolean }) => {
  const state = JSON.stringify({
    vacancyResponsePopup: {
      vacancy: {
        unusedResumeIds: ["1001", "1002"],
        resumes: {
          "1001": { hash: HASH_A, id: "1001", title: [{ string: "Первое" }] },
          "1002": { hash: HASH_B, id: "1002", title: [{ string: "Второе" }] }
        }
      }
    }
  })
  return `<template id="HH-Lux-InitialState">${state}</template>
<div id="resume-host"><div data-qa="resume-title" role="button"><div data-qa="cell-text-content" id="resume-name">Первое</div></div><div id="resume-list"></div></div>
<script>
  window.__resume = '${HASH_A}';
  const names = { '${HASH_A}': 'Первое', '${HASH_B}': 'Второе' };
  const list = document.getElementById('resume-list');
  document.querySelector('[data-qa=resume-title]').addEventListener('click', () => {
    setTimeout(() => {
      list.innerHTML = Object.keys(names).map((h) => '<label role="option" data-magritte-select-option="' + h + '" aria-selected="' + (window.__resume === h) + '"><input type="radio" value="' + h + '"' + (window.__resume === h ? ' checked' : '') + '>' + names[h] + '</label>').join('');
      for (const label of list.querySelectorAll('label')) {
        label.addEventListener('click', () => {
          ${opts.broken ? "" : "window.__resume = label.getAttribute('data-magritte-select-option'); document.getElementById('resume-name').textContent = names[window.__resume];"}
          list.innerHTML = '';
        });
      }
    }, ${opts.slow ? 1500 : 0});
  });
</script>`
}

const page = (opts: { silent?: boolean; letter?: boolean; rename?: boolean; resume?: "ok" | "slow" | "broken" } = {}) => {
  let html = base
  if (opts.rename) html = html.replace("В каком городе проживаете?", "В какой стране проживаете?")
  if (opts.letter) {
    html = html.replace(
      '<button type="submit"',
      '<textarea data-qa="vacancy-response-popup-form-letter-input" name="letter"></textarea>\n<button type="submit"'
    )
  }
  const widget = opts.resume === undefined ? "" : resumeWidget({ slow: opts.resume === "slow", broken: opts.resume === "broken" })
  html = html.replace("</body>", `${widget}</body>`)
  const flag = opts.silent ? "<script>window.__silent = true</script>" : ""
  return html.replace("</body>", `${flag}${SCRIPT}</body>`)
}

const synthetic = (name: string) =>
  readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")
const vacancyOpen = synthetic("synthetic-vacancy-open.html")
const vacancyResponded = synthetic("synthetic-vacancy-responded.html")
const negotiationsWith = synthetic("synthetic-negotiations.html")
const negotiationsEmpty = synthetic("synthetic-negotiations-empty.html")
const negotiationsOther =
  '<template id="HH-Lux-InitialState">{"applicantNegotiations":{"topicList":[{"vacancyId":777,"lastState":"RESPONSE"}]}}</template>'
const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })

let reconcileMode = "open"
let lettersSent = 0
let lastResume: string | null = null

const letterPage = (stuck: boolean) => `<html><body>
<button data-qa="responded-success-attach-cover-letter" onclick="document.getElementById('dlg').style.display='block'">Приложить сопроводительное письмо</button>
<div id="dlg" style="display:none">
  <textarea data-qa="vacancy-response-popup-form-letter-input" name="text"></textarea>
  <button data-qa="vacancy-response-letter-submit" onclick="fetch('/letter',{method:'POST'}).then(()=>{ if (!${stuck}) document.getElementById('dlg').style.display='none' })">Отправить</button>
</div></body></html>`
const visited: Array<string> = []

let mode = "ok"
let posts = 0
let server: ReturnType<typeof Bun.serve>
let origin = ""
let profiles = ""

beforeAll(async () => {
  profiles = await mkdtemp(join(tmpdir(), "otbor-harness-profiles-"))
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/respond" && request.method === "POST") {
        posts += 1
        lastResume = new URLSearchParams(await request.text()).get("resume")
        return new Response("{}", { headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/letter" && request.method === "POST") {
        lettersSent += 1
        return new Response("{}", { headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/account/login") {
        return new Response("<html><body>login</body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" }
        })
      }
      // Reconcile: the vacancy page and the negotiations list. Synthetic pages.
      if (url.pathname === "/vacancy/100500") {
        visited.push(url.pathname)
        if (reconcileMode === "login") return Response.redirect(`${origin}/account/login`, 302)
        if (reconcileMode === "letter") return html(letterPage(false))
        if (reconcileMode === "letter-stuck") return html(letterPage(true))
        return html(reconcileMode === "responded" ? vacancyResponded : vacancyOpen)
      }
      if (url.pathname === "/applicant/negotiations") {
        visited.push(`${url.pathname}?page=${url.searchParams.get("page")}`)
        const index = Number(url.searchParams.get("page") ?? "0")
        if (reconcileMode === "responded" && index === 0) return html(negotiationsWith)
        // An account with other responses on page 0 and nothing after.
        return html(index === 0 ? negotiationsOther : negotiationsEmpty)
      }
      if (url.pathname === "/applicant/vacancy_response") {
        if (mode === "login") return Response.redirect(`${origin}/account/login`, 302)
        if (mode === "captcha") {
          return new Response("<html><body><div>Подтвердите, что вы не робот</div></body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" }
          })
        }
        const body =
          mode === "responded"
            ? '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'
            : mode === "silent"
              ? page({ silent: true })
              : mode === "renamed"
                ? page({ rename: true })
                : mode === "letter"
                  ? page({ letter: true })
                  : mode === "resume" || mode === "resume-slow" || mode === "resume-broken"
                    ? page({ resume: mode === "resume" ? "ok" : mode === "resume-slow" ? "slow" : "broken" })
                  : page()
        return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      return new Response("not found", { status: 404 })
    }
  })
  origin = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  server?.stop(true)
  if (profiles !== "") await rm(profiles, { recursive: true, force: true })
})

const executor = () =>
  makePlaywrightExecutor({
    baseUrl: origin,
    profilesDir: profiles,
    executablePath: null,
    headless: true,
    navigationTimeoutMs: 10_000,
    settleMs: 4_000,
    afterClickMs: 2_000
  })

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
  answer("387049556", { optionIds: ["387049558"] }),
  answer("387049560", { text: "300000" })
]

const liveHash = parseResponseForm(page(), `${"http://x"}/applicant/vacancy_response?vacancyId=1`).formHash

const submitPayload = (over: Partial<SubmitJobPayload> = {}): SubmitJobPayload => ({
  applicationId: "app",
  vacancyId: "vac",
  externalId: "100500",
  canonicalUrl: "https://hh.ru/vacancy/100500",
  sessionProfile: "test-account",
  kitId: "kit",
  expectedFormHash: liveHash,
  kit: { formHash: liveHash, letter: null, answers },
  ...over
})

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe.skipIf(!hasBrowser)("PlaywrightBrowserExecutor against a local hh imitation", () => {
  test("prepare returns the form fragment and the cloud parses the same hash", async () => {
    mode = "ok"
    const exit = await run(
      executor().prepare({
        vacancyId: "vac",
        externalId: "100500",
        canonicalUrl: "https://hh.ru/vacancy/100500",
        sessionProfile: "test-account"
      })
    )
    expect(exit.tag).toBe("prepared")
    const artifacts = exit.artifacts as { url: string; html: string }
    expect(artifacts.url).toStartWith(origin)
    expect(parseResponseForm(artifacts.html, artifacts.url).formHash).toBe(liveHash)
    expect(posts).toBe(0)
  }, 30_000)

  test("prepare reports a login redirect and an already responded page", async () => {
    const payload = {
      applicationId: "app",
      vacancyId: "vac",
      externalId: "100500",
      canonicalUrl: "https://hh.ru/vacancy/100500",
      sessionProfile: "test-account"
    }
    mode = "login"
    expect((await run(executor().prepare(payload))).tag).toBe("session_expired")
    mode = "responded"
    expect((await run(executor().prepare(payload))).tag).toBe("already_responded")
    expect(posts).toBe(0)
  }, 40_000)

  test("a captcha leaves a debug screenshot and its path in the exit message", async () => {
    mode = "captcha"
    posts = 0
    const shots = await mkdtemp(join(tmpdir(), "otbor-shots-"))
    try {
      const exit = await run(
        makePlaywrightExecutor({
          baseUrl: origin,
          profilesDir: profiles,
          executablePath: null,
          headless: true,
          navigationTimeoutMs: 10_000,
          settleMs: 4_000,
          captchaShotsDir: shots
        }).prepare({
          vacancyId: "vac",
          externalId: "100500",
          canonicalUrl: "https://hh.ru/vacancy/100500",
          sessionProfile: "test-account"
        })
      )
      expect(exit.tag).toBe("captcha")
      const files = readdirSync(shots)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/form-100500\.png$/)
      expect(exit.message).toContain(join(shots, files[0]!))
      expect(posts).toBe(0)
    } finally {
      await rm(shots, { recursive: true, force: true })
      mode = "ok"
    }
  }, 30_000)

  test("submit fills the form, clicks exactly once and reports page evidence", async () => {
    mode = "ok"
    posts = 0
    let checks = 0
    const exit = await run(
      executor().submit({
        payload: submitPayload(),
        beforeClick: Effect.sync(() => {
          checks += 1
          return true
        })
      })
    )
    expect(exit).toMatchObject({ tag: "submitted" })
    expect(posts).toBe(1)
    expect(checks).toBe(1)
    const evidence = exit.artifacts as { clicked: boolean; url: string; html: string }
    expect(evidence.clicked).toBe(true)
    expect(isSubmitSuccess(evidence.html, evidence.url)).toBe(true)
  }, 40_000)

  const withResume = async (m: string, over: Partial<SubmitJobPayload>) => {
    mode = m
    posts = 0
    lastResume = null
    return await run(executor().submit({ payload: submitPayload(over), beforeClick: Effect.succeed(true) }))
  }

  test("the resume is selected by hh id, with a late-rendered list, before the click", async () => {
    const exit = await withResume("resume-slow", { resumeExternalId: "1002", resumeTitle: "Второе" })
    expect(exit).toMatchObject({ tag: "submitted" })
    expect(posts).toBe(1)
    expect(lastResume).toBe(HASH_B)
  }, 40_000)

  test("the already selected resume is not touched", async () => {
    const exit = await withResume("resume", { resumeExternalId: "1001" })
    expect(exit).toMatchObject({ tag: "submitted" })
    expect(lastResume).toBe(HASH_A)
  }, 40_000)

  test("a resume id the page does not offer is blocked and nothing is sent", async () => {
    const exit = await withResume("resume", { resumeExternalId: "1003", resumeTitle: "Третье" })
    expect(exit.tag).toBe("blocked")
    expect(exit.artifacts).toMatchObject({ clicked: false })
    expect(posts).toBe(0)
  }, 40_000)

  test("a select that does not switch is blocked and nothing is sent", async () => {
    const exit = await withResume("resume-broken", { resumeExternalId: "1002" })
    expect(exit.tag).toBe("blocked")
    expect(posts).toBe(0)
  }, 40_000)

  test("a legacy payload with a title but no id is blocked", async () => {
    const exit = await withResume("resume", { resumeTitle: "Второе" })
    expect(exit.tag).toBe("blocked")
    expect(posts).toBe(0)
  }, 40_000)

  test("auto humanize adds at most the budget and still sends exactly once", async () => {
    const baseline = Date.now()
    const plain = await withResume("resume", { resumeExternalId: "1001" })
    const plainMs = Date.now() - baseline
    expect(plain).toMatchObject({ tag: "submitted" })

    const budgetMs = 5_000
    mode = "resume"
    posts = 0
    const started = Date.now()
    const exit = await run(
      makePlaywrightExecutor({
        baseUrl: origin,
        profilesDir: profiles,
        executablePath: null,
        headless: true,
        navigationTimeoutMs: 10_000,
        settleMs: 4_000,
        afterClickMs: 2_000,
        humanizeBudgetMs: budgetMs
      }).submit({
        payload: submitPayload({ resumeExternalId: "1001", humanize: true }),
        beforeClick: Effect.succeed(true)
      })
    )
    const humanMs = Date.now() - started
    expect(exit).toMatchObject({ tag: "submitted" })
    expect(posts).toBe(1)
    // Добавка не больше бюджета (с запасом на разброс самой браузерной работы).
    expect(humanMs - plainMs).toBeLessThan(budgetMs + 1_500)
  }, 60_000)

  test("a changed live form is form_changed and nothing is sent", async () => {
    mode = "renamed"
    posts = 0
    const exit = await run(
      executor().submit({ payload: submitPayload(), beforeClick: Effect.succeed(true) })
    )
    expect(exit.tag).toBe("form_changed")
    expect(exit.artifacts).toMatchObject({ clicked: false })
    expect(posts).toBe(0)
  }, 40_000)

  test("a lost lease right before the click sends nothing", async () => {
    mode = "ok"
    posts = 0
    const exit = await run(
      executor().submit({ payload: submitPayload(), beforeClick: Effect.succeed(false) })
    )
    expect(exit.artifacts).toMatchObject({ clicked: false })
    expect(posts).toBe(0)
  }, 40_000)

  test("a page that never confirms is ambiguous with clicked: true, not retried", async () => {
    mode = "silent"
    posts = 0
    const exit = await run(
      executor().submit({ payload: submitPayload(), beforeClick: Effect.succeed(true) })
    )
    expect(exit.tag).toBe("ambiguous")
    expect(exit.artifacts).toMatchObject({ clicked: true })
    expect(posts).toBe(1)
  }, 40_000)

  const reconcilePayload = {
    applicationId: "app",
    vacancyId: "vac",
    externalId: "100500",
    canonicalUrl: "https://hh.ru/vacancy/100500",
    sessionProfile: "test-account"
  }

  test("reconcile of a responded vacancy without the resume hint reads only the vacancy page", async () => {
    reconcileMode = "responded"
    posts = 0
    visited.length = 0
    const exit = await run(executor().reconcile(reconcilePayload))
    expect(exit.tag).toBe("reconciled")
    const evidence = exit.artifacts as {
      externalId: string
      vacancy: { url: string; html: string }
      negotiations: ReadonlyArray<{ url: string; html: string }>
    }
    expect(evidence.externalId).toBe("100500")
    expect(evidence.vacancy.url).toBe(`${origin}/vacancy/100500`)
    // The cloud's reading of the same page finds the response.
    expect(readResponseStatus(evidence.vacancy.html, "100500", "https://hh.ru/vacancy/100500").state).toBe("responded")
    expect(evidence.negotiations).toHaveLength(0)
    expect(posts).toBe(0)
    expect(visited).toEqual(["/vacancy/100500"])
  }, 40_000)

  test("reconcile of a vacancy without a response does not open the list", async () => {
    reconcileMode = "open"
    posts = 0
    visited.length = 0
    const exit = await run(executor().reconcile({ ...reconcilePayload, needsResume: true }))
    expect(exit.tag).toBe("reconciled")
    expect((exit.artifacts as { negotiations: ReadonlyArray<unknown> }).negotiations).toHaveLength(0)
    expect(posts).toBe(0)
    expect(visited).toEqual(["/vacancy/100500"])
  }, 40_000)

  test("reconcile with the resume hint reads the list only to the page that holds the vacancy", async () => {
    reconcileMode = "responded"
    posts = 0
    visited.length = 0
    const exit = await run(executor().reconcile({ ...reconcilePayload, needsResume: true }))
    expect(exit.tag).toBe("reconciled")
    const evidence = exit.artifacts as { negotiations: ReadonlyArray<{ url: string; html: string }> }
    expect(parseNegotiations(evidence.negotiations[0]!.html).topics.map((topic) => topic.vacancyId)).toContain("100500")
    expect(evidence.negotiations).toHaveLength(1)
    expect(posts).toBe(0)
    expect(visited).toEqual(["/vacancy/100500", "/applicant/negotiations?page=0"])
  }, 40_000)

  test("reconcile with the resume hint and an absent topic reads the list to its end", async () => {
    reconcileMode = "responded"
    visited.length = 0
    // The topic on page 0 belongs to no such resume: reading goes on to the empty page.
    const exit = await run(
      executor().reconcile({ ...reconcilePayload, needsResume: true, resumeExternalId: "no-such-resume" })
    )
    const evidence = exit.artifacts as { negotiations: ReadonlyArray<{ html: string }> }
    expect(evidence.negotiations).toHaveLength(2)
    expect(parseNegotiations(evidence.negotiations[1]!.html)).toEqual({ readable: true, topics: [], pageCount: null })
  }, 40_000)

  test("reconcile with a bounded page budget stops there", async () => {
    reconcileMode = "responded"
    const exit = await run(
      makePlaywrightExecutor({
        baseUrl: origin,
        profilesDir: profiles,
        executablePath: null,
        headless: true,
        navigationTimeoutMs: 10_000,
        settleMs: 4_000,
        maxNegotiationPages: 1
      }).reconcile({ ...reconcilePayload, needsResume: true, resumeExternalId: "no-such-resume" })
    )
    expect((exit.artifacts as { negotiations: ReadonlyArray<unknown> }).negotiations).toHaveLength(1)
  }, 40_000)

  test("reconcile reports a login redirect as session_expired", async () => {
    reconcileMode = "login"
    const exit = await run(executor().reconcile(reconcilePayload))
    expect(exit.tag).toBe("session_expired")
    reconcileMode = "open"
  }, 40_000)

  test("a cover letter field on the form is filled before the click", async () => {
    mode = "letter"
    posts = 0
    const payload = submitPayload({
      kit: { formHash: liveHash, letter: "Здравствуйте, это письмо", answers }
    })
    const exit = await run(
      executor().submit({ payload, beforeClick: Effect.succeed(true) })
    )
    expect(exit.tag).toBe("submitted")
    expect(posts).toBe(1)
  }, 40_000)
})

if (!hasBrowser) {
  test("real-browser executor tests are skipped: Playwright Chromium is not installed", () => {
    expect(hasBrowser).toBe(false)
  })
}

describe.skipIf(!hasBrowser)("attachLetter", () => {
  const payload = {
    vacancyId: "vac",
    externalId: "100500",
    canonicalUrl: "https://hh.ru/vacancy/100500",
    sessionProfile: "test-account",
    letter: "Здравствуйте, это письмо."
  }

  test("types the letter, presses send once and reports the closed dialog", async () => {
    reconcileMode = "letter"
    lettersSent = 0
    const exit = await run(executor().attachLetter({ payload, beforeClick: Effect.succeed(true) }))
    expect(exit.tag).toBe("submitted")
    expect(exit.artifacts).toMatchObject({ clicked: true, closed: true })
    expect(lettersSent).toBe(1)
  }, 40_000)

  test("a dialog that stays open after the click is ambiguous, not sent", async () => {
    reconcileMode = "letter-stuck"
    lettersSent = 0
    const exit = await run(executor().attachLetter({ payload, beforeClick: Effect.succeed(true) }))
    expect(exit.tag).toBe("ambiguous")
    expect(exit.artifacts).toMatchObject({ clicked: true, closed: false })
    expect(lettersSent).toBe(1)
  }, 40_000)

  test("a lost lease means no click", async () => {
    reconcileMode = "letter"
    lettersSent = 0
    const exit = await run(executor().attachLetter({ payload, beforeClick: Effect.succeed(false) }))
    expect(exit.artifacts).toMatchObject({ clicked: false })
    expect(lettersSent).toBe(0)
  }, 40_000)

  test("a vacancy without a response is not touched", async () => {
    reconcileMode = "open"
    lettersSent = 0
    const exit = await run(executor().attachLetter({ payload, beforeClick: Effect.succeed(true) }))
    expect(exit.tag).toBe("not_submitted")
    expect(lettersSent).toBe(0)
  }, 40_000)
})
