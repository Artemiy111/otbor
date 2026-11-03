import type { FormAnswer, SubmitJobPayload } from "@otbor/contract"
import { isSubmitSuccess, parseResponseForm } from "@otbor/hh"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
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
    await fetch('/respond', { method: 'POST', body: new URLSearchParams(new FormData(form)) });
    if (!window.__silent) {
      document.body.innerHTML = '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>';
    }
  });
</script>`

const page = (opts: { silent?: boolean; letter?: boolean; rename?: boolean } = {}) => {
  let html = base
  if (opts.rename) html = html.replace("В каком городе проживаете?", "В какой стране проживаете?")
  if (opts.letter) {
    html = html.replace(
      '<button type="submit"',
      '<textarea data-qa="vacancy-response-popup-form-letter-input" name="letter"></textarea>\n<button type="submit"'
    )
  }
  const flag = opts.silent ? "<script>window.__silent = true</script>" : ""
  return html.replace("</body>", `${flag}${SCRIPT}</body>`)
}

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
        return new Response("{}", { headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/account/login") {
        return new Response("<html><body>login</body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" }
        })
      }
      if (url.pathname === "/applicant/vacancy_response") {
        if (mode === "login") return Response.redirect(`${origin}/account/login`, 302)
        const body =
          mode === "responded"
            ? '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'
            : mode === "silent"
              ? page({ silent: true })
              : mode === "renamed"
                ? page({ rename: true })
                : mode === "letter"
                  ? page({ letter: true })
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
        applicationId: "app",
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
