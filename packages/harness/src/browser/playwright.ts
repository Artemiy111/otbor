import type {
  HarnessExit,
  NegotiationsSyncJobPayload,
  FormReadJobPayload,
  LetterAttachJobPayload,
  ReconcileJobPayload,
  ResumeSyncJobPayload,
  ReconcilePage,
  SubmitEvidence
} from "@otbor/contract"
import { classifyResponsePage, parseResumeRefs } from "@otbor/hh"
import { Effect, Layer, Schema } from "effect"
import { existsSync } from "node:fs"
import { chromium, type Page } from "playwright"
import {
  CHAT_INPUT_SELECTOR,
  RESUME_OPTION_SELECTOR,
  RESUME_SELECTED_SELECTOR,
  CHAT_LETTER_BUTTON_SELECTOR,
  CHAT_LETTER_PREVIEW_SELECTOR,
  chatUrl,
  LETTER_ATTACH_SELECTOR,
  LETTER_SELECTOR,
  LETTER_SUBMIT_SELECTOR,
  letterUnclicked,
  MAX_NEGOTIATION_PAGES,
  MAX_SYNC_PAGES,
  MAX_SYNC_RESUMES,
  RELOCATION_SELECTOR,
  SUBMIT_SELECTOR,
  negotiationsSyncExit,
  negotiationsUrl,
  postClickExit,
  profileUrl,
  resumeSyncExit,
  resumeUrl,
  prepareExit,
  reconcileExit,
  responseUrl,
  submitPreflight,
  vacancyUrl,
  wantsMoreNegotiations,
  wantsMoreSyncPages
} from "./core.ts"
import { BrowserExecutor, type LetterAttachRequest, type SubmitRequest } from "./executor.ts"
import { DEFAULT_CHROME_PATH, hhProfileDir } from "./profile.ts"

export class BrowserError extends Schema.TaggedError<BrowserError>()("BrowserError", {
  message: Schema.String
}) {}

export interface PlaywrightOptions {
  /** hh origin. Tests point this at a local server; production keeps the default. */
  readonly baseUrl?: string
  /** Root of the per-account profiles. Defaults to `~/.otbor/hh/accounts`. */
  readonly profilesDir?: string
  /** `null` uses Playwright's bundled Chromium. Default: installed Google Chrome. */
  readonly executablePath?: string | null
  readonly headless?: boolean
  readonly navigationTimeoutMs?: number
  /** How long to wait for the response page to show a recognizable state. */
  readonly settleMs?: number
  /** How long to wait for the page to change after the submit click. */
  readonly afterClickMs?: number
  /** Negotiation pages a reconcile reads before giving up. */
  readonly maxNegotiationPages?: number
  /** Pause between negotiations pages of a sync, so a long list is read politely. */
  readonly syncDelayMs?: number
}

const defaults = {
  baseUrl: "https://hh.ru",
  navigationTimeoutMs: 30_000,
  settleMs: 12_000,
  afterClickMs: 25_000
}

const attempt = <A>(use: () => Promise<A>) =>
  Effect.tryPromise({
    try: use,
    catch: (cause) =>
      new BrowserError({ message: cause instanceof Error ? cause.message : String(cause) })
  })

const sleep = (ms: number) => Effect.sleep(`${ms} millis`)

const unclicked = (url: string): { artifacts: SubmitEvidence } => ({
  artifacts: { clicked: false, url, marker: "none" }
})

/**
 * The real executor: one persistent Chrome context per job, opened on the
 * account's profile and closed when the job ends or is interrupted.
 *
 * It only reads the page and presses buttons. What the outcome means is
 * decided by `core.ts` here and, authoritatively, by the cloud.
 */
export const makePlaywrightExecutor = (options: PlaywrightOptions = {}) => {
  const config = { ...defaults, ...options }
  const baseUrl = config.baseUrl
  const executablePath =
    config.executablePath === undefined
      ? existsSync(DEFAULT_CHROME_PATH)
        ? DEFAULT_CHROME_PATH
        : undefined
      : (config.executablePath ?? undefined)

  const profileDir = (name: string | null | undefined) =>
    config.profilesDir === undefined
      ? hhProfileDir(name)
      : hhProfileDir(name, { OTBOR_HH_PROFILES_DIR: config.profilesDir })

  /** Launches the profile, runs `use`, and always closes the browser. */
  const withPage = <A, E>(
    profile: string | null | undefined,
    use: (page: Page) => Effect.Effect<A, E>
  ) =>
    Effect.scoped(
      Effect.gen(function*() {
        const context = yield* Effect.acquireRelease(
          attempt(() =>
            chromium.launchPersistentContext(profileDir(profile), {
              headless: config.headless ?? true,
              ...(executablePath === undefined ? {} : { executablePath }),
              ignoreDefaultArgs: ["--no-sandbox"]
            })
          ),
          (opened) => Effect.promise(() => opened.close().catch(() => undefined))
        )
        const page = context.pages()[0] ?? (yield* attempt(() => context.newPage()))
        return yield* use(page)
      })
    )

  const content = (page: Page) =>
    attempt(() => page.content()).pipe(Effect.orElseSucceed(() => null as string | null))

  /** Polls until the page is something other than "unknown", or time runs out. */
  const settle = (page: Page, timeoutMs: number, until?: (kind: string) => boolean) =>
    Effect.gen(function*() {
      const deadline = Date.now() + timeoutMs
      let html = ""
      while (true) {
        const read = yield* content(page)
        if (read !== null) {
          html = read
          const kind = classifyResponsePage(html, page.url())
          if (until === undefined ? kind !== "unknown" : until(kind)) return html
        }
        if (Date.now() >= deadline) return html
        yield* sleep(250)
      }
    })

  const open = (page: Page, externalId: string) =>
    attempt(() =>
      page.goto(responseUrl(baseUrl, externalId), {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs
      })
    )

  const prepare = (payload: FormReadJobPayload): Effect.Effect<HarnessExit> =>
    withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        yield* open(page, payload.externalId)
        const html = yield* settle(page, config.settleMs)
        return prepareExit(html, page.url())
      })
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  const attachLetterAfterSubmit = (page: Page, letter: string) =>
    Effect.gen(function*() {
      const field = page.locator(LETTER_SELECTOR).first()
      if ((yield* attempt(() => field.count())) === 0 || !(yield* attempt(() => field.isVisible()))) {
        const toggle = page.locator(LETTER_ATTACH_SELECTOR).first()
        if ((yield* attempt(() => toggle.count())) > 0) {
          yield* attempt(() => toggle.click({ timeout: 5_000 }))
        }
      }
      yield* attempt(() => field.fill(letter, { timeout: 5_000 }))
      const value = yield* attempt(() => field.inputValue())
      if (value.trim() !== letter.trim()) return false
      // The dialog keeps the text until "Отправить" is pressed.
      yield* attempt(() => page.locator(LETTER_SUBMIT_SELECTOR).first().click({ timeout: 5_000 }))
      yield* attempt(() => field.waitFor({ state: "hidden", timeout: 8_000 }))
      return true
    }).pipe(Effect.orElseSucceed(() => false))

  const attachLetter = ({ payload, beforeClick }: LetterAttachRequest): Effect.Effect<HarnessExit> => {
    let clicked = false
    const inChat = typeof payload.chatId === "string" && payload.chatId !== ""
    let lastUrl = inChat ? chatUrl(baseUrl, payload.chatId as string) : vacancyUrl(baseUrl, payload.externalId)

    const run = withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        yield* attempt(() =>
          page.goto(lastUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs })
        )
        if (inChat) {
          yield* sleep(config.settleMs)
          lastUrl = page.url()
          if (/\/account\/login|\/login/.test(lastUrl)) {
            return letterUnclicked(lastUrl, "session_expired", "hh redirected to the login page")
          }
          if (!lastUrl.includes(`/chat/${payload.chatId}`)) {
            return letterUnclicked(lastUrl, "blocked", "hh did not open the chat of this response")
          }
          const button = page.locator(CHAT_LETTER_BUTTON_SELECTOR).first()
          yield* attempt(() => button.waitFor({ state: "visible", timeout: 10_000 })).pipe(
            Effect.orElseSucceed(() => undefined)
          )
          if ((yield* attempt(() => button.count())) === 0) {
            return letterUnclicked(
              lastUrl,
              "blocked",
              "the cover letter button is not in the chat (a letter may already be attached)"
            )
          }
          yield* attempt(() => button.click({ timeout: 5_000 }))
          const preview = page.locator(CHAT_LETTER_PREVIEW_SELECTOR).first()
          yield* attempt(() => preview.waitFor({ state: "visible", timeout: 8_000 }))
          const input = page.locator(CHAT_INPUT_SELECTOR).first()
          yield* attempt(() => input.fill(payload.letter, { timeout: 5_000 }))
          const written = yield* attempt(() => input.inputValue())
          if (written.trim() !== payload.letter.trim()) {
            return letterUnclicked(lastUrl, "blocked", "the letter did not land in the chat field")
          }
          // The last look before the only click: is this lease still ours?
          if (!(yield* beforeClick)) {
            return letterUnclicked(lastUrl, "transport", "lease lost before the click")
          }
          clicked = true
          // Enter sends in the chat field ("Enter — отправить сообщение"). A click on
          // the button can land on hh's cookie banner instead and send nothing.
          yield* attempt(() => input.press("Enter", { timeout: 5_000 }))
          // Sent when the letter mode is gone and the field is empty again.
          const closed = yield* attempt(() => preview.waitFor({ state: "hidden", timeout: 10_000 })).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false)
          )
          return {
            tag: closed ? "submitted" : "ambiguous",
            message: closed ? "letter sent in the chat" : "the chat still shows the letter field after the click",
            artifacts: { clicked: true, closed, url: page.url() }
          } satisfies HarnessExit
        }
        yield* sleep(config.settleMs)
        lastUrl = page.url()
        const html = (yield* content(page)) ?? ""
        const kind = classifyResponsePage(html, lastUrl)
        if (kind === "login") return letterUnclicked(lastUrl, "session_expired", "hh redirected to the login page")
        if (kind === "captcha") return letterUnclicked(lastUrl, "captcha", "hh asked for a captcha")
        if (kind === "archived") {
          return letterUnclicked(lastUrl, "vacancy_archived", "the vacancy is archived, hh takes no responses")
        }
        if (kind !== "responded") {
          return letterUnclicked(lastUrl, "not_submitted", "hh shows no response to this vacancy")
        }

        const toggle = page.locator(LETTER_ATTACH_SELECTOR).first()
        if ((yield* attempt(() => toggle.count())) === 0) {
          return letterUnclicked(lastUrl, "blocked", "the cover letter control is not on the page")
        }
        yield* attempt(() => toggle.click({ timeout: 5_000 }))
        const field = page.locator(LETTER_SELECTOR).first()
        yield* attempt(() => field.waitFor({ state: "visible", timeout: 8_000 }))
        yield* attempt(() => field.fill(payload.letter, { timeout: 5_000 }))
        const typed = yield* attempt(() => field.inputValue())
        if (typed.trim() !== payload.letter.trim()) {
          return letterUnclicked(lastUrl, "blocked", "the letter did not land in the field")
        }

        // The last look before the only click: is this lease still ours?
        if (!(yield* beforeClick)) {
          return letterUnclicked(lastUrl, "transport", "lease lost before the click")
        }
        clicked = true
        yield* attempt(() => page.locator(LETTER_SUBMIT_SELECTOR).first().click({ timeout: 5_000 }))
        const closed = yield* attempt(() => field.waitFor({ state: "hidden", timeout: 10_000 })).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false)
        )
        return {
          tag: closed ? "submitted" : "ambiguous",
          message: closed ? "letter sent" : "the letter dialog did not close after the click",
          artifacts: { clicked: true, closed, url: page.url() }
        } satisfies HarnessExit
      })
    )

    return run.pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>(
          clicked
            ? {
                tag: "ambiguous",
                message: `browser failed after the click: ${error.message}`,
                artifacts: { clicked: true, closed: false, url: lastUrl }
              }
            : letterUnclicked(lastUrl, "transport", error.message)
        )
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>(
          clicked
            ? {
                tag: "ambiguous",
                message: String(defect),
                artifacts: { clicked: true, closed: false, url: lastUrl }
              }
            : letterUnclicked(lastUrl, "transport", String(defect))
        )
      )
    )
  }

  const submit = ({ payload, beforeClick }: SubmitRequest): Effect.Effect<HarnessExit> => {
    let clicked = false
    let lastUrl = responseUrl(baseUrl, payload.externalId)

    const asClicked = (exit: HarnessExit): HarnessExit => ({
      ...exit,
      artifacts: { ...(exit.artifacts ?? {}), clicked: true }
    })

    const run = withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        yield* open(page, payload.externalId)
        let html = yield* settle(page, config.settleMs)
        lastUrl = page.url()
        let preflight = submitPreflight(payload, html, lastUrl)

        if (preflight._tag === "relocation") {
          // Confirming the warning may itself send the response, so it counts
          // as the click: the lease is checked first and nothing is retried.
          if (!(yield* beforeClick)) {
            return { tag: "transport", message: "lease lost before the click", ...unclicked(lastUrl) } satisfies HarnessExit
          }
          clicked = true
          yield* attempt(() => page.locator(RELOCATION_SELECTOR).first().click({ timeout: 5_000 }))
          html = yield* settle(page, config.settleMs, (kind) => kind === "form" || kind === "responded" || kind === "captcha")
          lastUrl = page.url()
          if (classifyResponsePage(html, lastUrl) === "responded") {
            return postClickExit(html, lastUrl)
          }
          preflight = submitPreflight(payload, html, lastUrl)
          if (preflight._tag === "relocation") {
            return asClicked({ tag: "ambiguous", message: "the relocation warning is still shown", ...unclicked(lastUrl) })
          }
        }

        if (preflight._tag === "exit") {
          return clicked ? asClicked(preflight.exit) : preflight.exit
        }

        // Fill. Nothing here sends anything.
        for (const step of preflight.steps) {
          const locator = page.locator(step.selector).first()
          if (step.kind === "check") {
            yield* attempt(() => locator.check({ timeout: 5_000 }))
          } else {
            yield* attempt(() => locator.fill(step.text, { timeout: 5_000 }))
          }
        }

        // hh sends the response with the resume its form has selected, so the
        // one the operator chose is selected here and checked before the click.
        const wanted = (payload.resumeTitle ?? "").trim()
        if (wanted !== "") {
          const selectedTitle = () =>
            attempt(() => page.locator(RESUME_SELECTED_SELECTOR).first().innerText()).pipe(
              Effect.map((title) => title.trim()),
              Effect.orElseSucceed(() => "")
            )
          if ((yield* selectedTitle()) !== wanted) {
            yield* attempt(() => page.locator(RESUME_SELECTED_SELECTOR).first().click({ timeout: 5_000 }))
            const option = page.locator(RESUME_OPTION_SELECTOR).filter({
              has: page.locator(RESUME_SELECTED_SELECTOR).getByText(wanted, { exact: true })
            })
            const matches = yield* attempt(() => option.count())
            if (matches !== 1) {
              return {
                tag: "blocked",
                message:
                  matches === 0
                    ? `hh offers no resume titled "${wanted}" for this response`
                    : `several resumes are titled "${wanted}"; cannot tell which one to use`,
                ...unclicked(lastUrl)
              } satisfies HarnessExit
            }
            yield* attempt(() => option.first().click({ timeout: 5_000 }))
            yield* sleep(300)
          }
          const chosen = yield* selectedTitle()
          if (chosen !== wanted) {
            return {
              tag: "blocked",
              message: `the response form uses the resume "${chosen}", not "${wanted}"`,
              ...unclicked(lastUrl)
            } satisfies HarnessExit
          }
        }

        const letter = (payload.kit.letter ?? "").trim()
        let pendingLetter: string | null = null
        if (letter !== "") {
          const field = page.locator(LETTER_SELECTOR).first()
          const present = (yield* attempt(() => field.count())) > 0 && (yield* attempt(() => field.isVisible()))
          if (present) {
            yield* attempt(() => field.fill(letter, { timeout: 5_000 }))
          } else if (preflight.form.coverLetter === "required") {
            return {
              tag: "answer_rejected",
              message: "the form requires a cover letter but has no letter field",
              ...unclicked(lastUrl)
            } satisfies HarnessExit
          } else {
            // hh accepts the response without a letter and takes it afterwards.
            pendingLetter = letter
          }
        }

        const submitButton = page.locator(SUBMIT_SELECTOR).first()
        let enabled = false
        for (let waited = 0; waited < 7_000 && !enabled; waited += 200) {
          enabled = yield* attempt(() => submitButton.isEnabled()).pipe(Effect.orElseSucceed(() => false))
          if (!enabled) yield* sleep(200)
        }
        if (!enabled) {
          return {
            tag: "answer_rejected",
            message: "the submit button stayed disabled after filling the form",
            ...unclicked(lastUrl)
          } satisfies HarnessExit
        }

        // The last look before the only click: is this lease still ours?
        if (!(yield* beforeClick)) {
          return { tag: "transport", message: "lease lost before the click", ...unclicked(lastUrl) } satisfies HarnessExit
        }

        // From here on the response may reach hh whatever happens next.
        clicked = true
        yield* attempt(() => submitButton.click({ timeout: 10_000, noWaitAfter: true }))

        const after = yield* settle(
          page,
          config.afterClickMs,
          (kind) => kind === "responded" || kind === "captcha"
        )
        lastUrl = page.url()

        let letterAttached: boolean | undefined
        if (pendingLetter !== null && classifyResponsePage(after, lastUrl) === "responded") {
          letterAttached = yield* attachLetterAfterSubmit(page, pendingLetter)
        }
        const finalHtml = (yield* content(page)) ?? after
        return postClickExit(finalHtml, page.url(), letterAttached === undefined ? {} : { letterAttached })
      })
    )

    return run.pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>(
          clicked
            ? {
                tag: "ambiguous",
                message: `browser failed after the click: ${error.message}`,
                artifacts: { clicked: true, url: lastUrl, marker: "none" } satisfies SubmitEvidence
              }
            : { tag: "transport", message: error.message, ...unclicked(lastUrl) }
        )
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>(
          clicked
            ? {
                tag: "ambiguous",
                message: `browser crashed after the click: ${String(defect)}`,
                artifacts: { clicked: true, url: lastUrl, marker: "none" } satisfies SubmitEvidence
              }
            : { tag: "transport", message: String(defect), ...unclicked(lastUrl) }
        )
      )
    )
  }

  /**
   * Opens the vacancy and then the negotiations list and returns what it saw.
   * Only navigation: no control on either page is clicked, so a reconcile can
   * never send a response.
   */
  const reconcile = (payload: ReconcileJobPayload): Effect.Effect<HarnessExit> =>
    withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        const settled = (url: string, ready: (html: string) => boolean) =>
          Effect.gen(function*() {
            yield* attempt(() =>
              page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs })
            )
            const deadline = Date.now() + config.settleMs
            let html = ""
            while (true) {
              const read = yield* content(page)
              if (read !== null) {
                html = read
                const kind = classifyResponsePage(html, page.url())
                if (kind === "login" || kind === "captcha" || ready(html)) break
              }
              if (Date.now() >= deadline) break
              yield* sleep(250)
            }
            return { url: page.url(), html } satisfies ReconcilePage
          })

        const vacancy = yield* settled(vacancyUrl(baseUrl, payload.externalId), (html) =>
          /vacancy-response-link|вы\s+откликнулись/i.test(html)
        )
        const early = reconcileExit(payload.externalId, { vacancy, negotiations: [] })
        if (early.tag !== "reconciled") return early

        const negotiations: Array<ReconcilePage> = []
        const limit = config.maxNegotiationPages ?? MAX_NEGOTIATION_PAGES
        for (let index = 0; index < limit; index += 1) {
          const read = yield* settled(negotiationsUrl(baseUrl, index), (html) =>
            html.includes("HH-Lux-InitialState")
          )
          negotiations.push(read)
          if (!wantsMoreNegotiations(read.html, payload.externalId)) break
        }
        return reconcileExit(payload.externalId, { vacancy, negotiations })
      })
    ).pipe(
      // Reading failed: nothing was sent, and the cloud retries the reconcile.
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  /**
   * Opens negotiations pages 0..N in order, with a pause between them, and
   * returns what it saw. Navigation only; nothing on the page is clicked.
   */
  const negotiationsSync = (payload: NegotiationsSyncJobPayload): Effect.Effect<HarnessExit> =>
    withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        const pages: Array<ReconcilePage> = []
        const limit = Math.min(payload.maxPages ?? MAX_SYNC_PAGES, MAX_SYNC_PAGES)
        for (let index = 0; index < limit; index += 1) {
          if (index > 0) yield* sleep(config.syncDelayMs ?? 1_500)
          yield* attempt(() =>
            page.goto(negotiationsUrl(baseUrl, index), {
              waitUntil: "domcontentloaded",
              timeout: config.navigationTimeoutMs
            })
          )
          const deadline = Date.now() + config.settleMs
          let html = ""
          while (true) {
            const read = yield* content(page)
            if (read !== null) {
              html = read
              const kind = classifyResponsePage(html, page.url())
              if (kind === "login" || kind === "captcha" || html.includes("HH-Lux-InitialState")) break
            }
            if (Date.now() >= deadline) break
            yield* sleep(250)
          }
          pages.push({ url: page.url(), html })
          if (!wantsMoreSyncPages(html, index)) break
        }
        return negotiationsSyncExit(pages)
      })
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  /**
   * Opens the profile page, then each resume it lists, with a pause between
   * pages, and returns what it saw. Navigation only.
   */
  const resumeSync = (payload: ResumeSyncJobPayload): Effect.Effect<HarnessExit> =>
    withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        const read = (url: string, ready: (html: string) => boolean) =>
          Effect.gen(function*() {
            yield* attempt(() =>
              page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs })
            )
            const deadline = Date.now() + config.settleMs
            let html = ""
            while (true) {
              const got = yield* content(page)
              if (got !== null) {
                html = got
                const kind = classifyResponsePage(html, page.url())
                if (kind === "login" || kind === "captcha" || ready(html)) break
              }
              if (Date.now() >= deadline) break
              yield* sleep(250)
            }
            return { url: page.url(), html } satisfies ReconcilePage
          })

        const profile = yield* read(profileUrl(baseUrl), (html) => parseResumeRefs(html).length > 0)
        const refs = parseResumeRefs(profile.html)
        const limit = Math.min(payload.maxResumes ?? MAX_SYNC_RESUMES, MAX_SYNC_RESUMES)
        const resumes: Array<ReconcilePage> = []
        for (const ref of refs.slice(0, limit)) {
          yield* sleep(config.syncDelayMs ?? 1_500)
          resumes.push(yield* read(resumeUrl(baseUrl, ref.hash), (html) => html.includes("HH-Lux-InitialState")))
        }
        return resumeSyncExit(profile, resumes)
      })
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  return BrowserExecutor.of({ prepare, submit, attachLetter, reconcile, negotiationsSync, resumeSync })
}

export const PlaywrightBrowserExecutor = {
  layer: (options: PlaywrightOptions = {}) =>
    Layer.succeed(BrowserExecutor)(makePlaywrightExecutor(options))
}
