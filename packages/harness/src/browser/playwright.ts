import type { HarnessExit, PrepareJobPayload, SubmitEvidence } from "@otbor/contract"
import { classifyResponsePage } from "@otbor/hh"
import { Effect, Layer, Schema } from "effect"
import { existsSync } from "node:fs"
import { chromium, type Page } from "playwright"
import {
  LETTER_ATTACH_SELECTOR,
  LETTER_SELECTOR,
  RELOCATION_SELECTOR,
  SUBMIT_SELECTOR,
  postClickExit,
  prepareExit,
  responseUrl,
  submitPreflight
} from "./core.ts"
import { BrowserExecutor, type SubmitRequest } from "./executor.ts"
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

  const prepare = (payload: PrepareJobPayload): Effect.Effect<HarnessExit> =>
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
      // hh saves the letter on blur.
      yield* attempt(() => field.blur())
      yield* sleep(400)
      const value = yield* attempt(() => field.inputValue())
      return value.trim() === letter.trim()
    }).pipe(Effect.orElseSucceed(() => false))

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

  return BrowserExecutor.of({ prepare, submit })
}

export const PlaywrightBrowserExecutor = {
  layer: (options: PlaywrightOptions = {}) =>
    Layer.succeed(BrowserExecutor)(makePlaywrightExecutor(options))
}
