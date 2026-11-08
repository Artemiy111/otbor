import type {
  HarnessExit,
  NegotiationsSyncJobPayload,
  FormReadJobPayload,
  LetterAttachJobPayload,
  ReconcileJobPayload,
  ChatReadJobPayload,
  ResumeSyncJobPayload,
  ReconcilePage,
  SubmitEvidence
} from "@otbor/contract"
import { isTrackerUrl } from "./trackers.ts"
import { classifyResponsePage, parseResumeRefs, readResponseStatus, responseResumeHash } from "@otbor/hh"
import { Effect, Layer, Schema, Semaphore } from "effect"
import { existsSync } from "node:fs"
import { chromium, type BrowserContext, type Page } from "playwright"
import {
  CHAT_INPUT_SELECTOR,
  RESUME_CHOSEN_OPTION_SELECTOR,
  RESUME_OPTION_SELECTOR,
  RESUME_SELECTED_SELECTOR,
  isResumeHash,
  resumeOptionSelector,
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
  chatDataUrl,
  chatReadExit,
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
  /**
   * Сколько действующих задач (submit, letter_attach) профиль выполняет разом.
   * По умолчанию 1, как потолок облака `OTBOR_ACCOUNT_SUBMIT_CONCURRENCY`;
   * облако остаётся главным, это страховка на стороне харнесса.
   */
  readonly accountActingConcurrency?: number
}

const defaults = {
  baseUrl: "https://hh.ru",
  navigationTimeoutMs: 30_000,
  settleMs: 12_000,
  afterClickMs: 25_000,
  accountActingConcurrency: 1
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

  /**
   * One Chrome per profile directory: Chrome locks a profile, so concurrent jobs
   * of the same account share a context and each gets its own page. The context
   * opens with the first user and closes with the last; a new user waits for a
   * close that is still running.
   */
  const shared = new Map<string, { readonly context: Promise<BrowserContext>; users: number }>()
  const closing = new Map<string, Promise<void>>()
  const exclusive = new Map<string, Semaphore.Semaphore>()

  const launch = async (dir: string) => {
    const context = await chromium.launchPersistentContext(dir, {
      headless: config.headless ?? true,
      ...(executablePath === undefined ? {} : { executablePath }),
      ignoreDefaultArgs: ["--no-sandbox"]
    })
    // Analytics and ad beacons only slow hh's pages down.
    await context.route(
      (url) => isTrackerUrl(url.href),
      (route) => route.abort()
    )
    return context
  }

  const joinContext = async (dir: string): Promise<BrowserContext> => {
    await closing.get(dir)
    let entry = shared.get(dir)
    if (entry === undefined) {
      entry = { context: launch(dir), users: 0 }
      shared.set(dir, entry)
    }
    entry.users += 1
    try {
      return await entry.context
    } catch (error) {
      leaveContext(dir)
      throw error
    }
  }

  const leaveContext = (dir: string): void => {
    const entry = shared.get(dir)
    if (entry === undefined) return
    entry.users -= 1
    if (entry.users > 0) return
    shared.delete(dir)
    const done = entry.context
      .then((context) => context.close())
      .catch(() => undefined)
      .finally(() => {
        if (closing.get(dir) === done) closing.delete(dir)
      })
    closing.set(dir, done)
  }

  /**
   * Opens a page of the profile's browser, runs `use`, always closes the page and
   * releases the browser. Jobs that act on the account (everything but a form
   * read) делят пул разрешений профиля (`accountActingConcurrency`); читающие
   * задачи идут без ограничения.
   */
  const withPage = <A, E>(
    profile: string | null | undefined,
    use: (page: Page) => Effect.Effect<A, E>,
    options: { readonly parallel?: boolean } = {}
  ) => {
    const dir = profileDir(profile)
    const run = Effect.scoped(
      Effect.gen(function*() {
        const context = yield* Effect.acquireRelease(
          attempt(() => joinContext(dir)),
          () => Effect.sync(() => leaveContext(dir))
        )
        const page = yield* Effect.acquireRelease(
          attempt(() => context.newPage()),
          (opened) => Effect.promise(() => opened.close().catch(() => undefined))
        )
        return yield* use(page)
      })
    )
    if (options.parallel === true) return run
    let gate = exclusive.get(dir)
    if (gate === undefined) {
      gate = Semaphore.makeUnsafe(Math.max(1, Math.floor(config.accountActingConcurrency)))
      exclusive.set(dir, gate)
    }
    return gate.withPermits(1)(run)
  }

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
      }),
      { parallel: true }
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

        // hh отправляет отклик с тем резюме, которое выбрано в форме, поэтому
        // нужное выбирается здесь по id и проверяется до клика. Любое
        // расхождение это `blocked`: кнопка не нажимается.
        const wantedId = (payload.resumeExternalId ?? "").trim()
        const wantedTitle = (payload.resumeTitle ?? "").trim()
        if (wantedId === "" && wantedTitle !== "") {
          // Старый payload без id: по названию не выбираем (оно не ключ), блокируем.
          return {
            tag: "blocked",
            message: `the job has no hh resume id for "${wantedTitle}"; cannot pick the resume safely`,
            ...unclicked(lastUrl)
          } satisfies HarnessExit
        }
        if (wantedId !== "") {
          const label = wantedTitle === "" ? wantedId : `"${wantedTitle}" (${wantedId})`
          const hash = responseResumeHash((yield* content(page)) ?? html, wantedId)
          if (hash === null || !isResumeHash(hash)) {
            return {
              tag: "blocked",
              message: `hh does not offer the resume ${label} for this response (hidden or not available for the vacancy)`,
              ...unclicked(lastUrl)
            } satisfies HarnessExit
          }
          const option = page.locator(resumeOptionSelector(hash))
          /** Хэш выбранного варианта; `null`, пока список не отрисован. */
          const chosenHash = () =>
            attempt(async () => {
              const radio = page.locator(`${RESUME_CHOSEN_OPTION_SELECTOR} input[type="radio"]`).first()
              return (await radio.count()) === 0 ? null : await radio.getAttribute("value", { timeout: 2_000 })
            }).pipe(Effect.orElseSucceed(() => null as string | null))
          const optionShown = () => attempt(() => option.count()).pipe(Effect.orElseSucceed(() => 0))
          /** Ждёт до ~5 с, пока вариант появится в DOM. */
          const waitOption = Effect.gen(function*() {
            for (let waited = 0; waited < 5_000; waited += 250) {
              if ((yield* optionShown()) > 0) return true
              yield* sleep(250)
            }
            return false
          })
          const clickCard = attempt(() => page.locator(RESUME_SELECTED_SELECTOR).first().click({ timeout: 5_000 }))
          /**
           * Форма видна в HTML раньше, чем React навесит обработчики, и первый
           * клик по карточке резюме может ничего не открыть. Кликаем заново,
           * только если за ~2 с вариантов так и не появилось (открытый список
           * повторный клик закрыл бы).
           */
          const openSelect = Effect.gen(function*() {
            for (let tries = 0; tries < 4; tries++) {
              yield* clickCard
              for (let waited = 0; waited < 2_000; waited += 250) {
                if ((yield* attempt(() => page.locator(RESUME_OPTION_SELECTOR).count()).pipe(Effect.orElseSucceed(() => 0))) > 0) {
                  return
                }
                yield* sleep(250)
              }
            }
          })
          const closeSelect = attempt(() => page.keyboard.press("Escape")).pipe(Effect.ignore)
          const blockedWith = (message: string) =>
            ({ tag: "blocked", message, ...unclicked(lastUrl) }) satisfies HarnessExit

          if ((yield* chosenHash()) !== hash) {
            yield* openSelect
            if (!(yield* waitOption)) {
              return blockedWith(`the resume ${label} did not appear in hh's resume select`)
            }
            yield* attempt(() => option.first().click({ timeout: 5_000 }))
            yield* sleep(300)
          }
          // Проверка по id: после клика выбранным должен быть вариант этого хэша.
          // Если список закрылся и вариантов в DOM нет, открываем его заново.
          let verified = false
          for (let waited = 0; waited < 5_000 && !verified; waited += 250) {
            let current = yield* chosenHash()
            if (current === null && waited === 0) {
              yield* openSelect
              yield* waitOption
              current = yield* chosenHash()
            }
            verified = current === hash
            if (!verified) yield* sleep(250)
          }
          yield* closeSelect
          if (!verified) {
            return blockedWith(`the response form did not switch to the resume ${label}`)
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

        // Список откликов нужен только когда страница вакансии говорит «вы
        // откликнулись», а облако не может сказать, с каким резюме (подсказка
        // `needsResume`). Иначе страницы вакансии достаточно: «откликнуться»
        // на ней - отсутствие отклика, «вы откликнулись» - его наличие.
        const negotiations: Array<ReconcilePage> = []
        const responded =
          readResponseStatus(vacancy.html, payload.externalId, vacancy.url).state === "responded"
        if (responded && payload.needsResume === true) {
          const limit = config.maxNegotiationPages ?? MAX_NEGOTIATION_PAGES
          for (let index = 0; index < limit; index += 1) {
            const read = yield* settled(negotiationsUrl(baseUrl, index), (html) =>
              html.includes("HH-Lux-InitialState")
            )
            negotiations.push(read)
            if (!wantsMoreNegotiations(read.html, payload.externalId, index, payload.resumeExternalId ?? null)) {
              break
            }
          }
        }
        return reconcileExit(payload.externalId, { vacancy, negotiations })
      }),
      { parallel: true }
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
      }),
      { parallel: true }
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
      }),
      { parallel: true }
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  /**
   * One authenticated GET through the profile's cookie jar. A blank page is
   * only the handle to the context; it is never navigated.
   */
  const chatRead = (payload: ChatReadJobPayload): Effect.Effect<HarnessExit> =>
    withPage(payload.sessionProfile, (page) =>
      Effect.gen(function*() {
        const response = yield* attempt(() =>
          page.context().request.get(chatDataUrl(baseUrl, payload.chatId), {
            headers: { accept: "application/json" },
            timeout: config.navigationTimeoutMs
          })
        )
        const body = yield* attempt(() => response.text())
        return chatReadExit(payload.chatId, response.status(), body)
      }),
      { parallel: true }
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: error.message })
      ),
      Effect.catchDefect((defect) =>
        Effect.succeed<HarnessExit>({ tag: "transport", message: String(defect) })
      )
    )

  return BrowserExecutor.of({ prepare, submit, attachLetter, reconcile, negotiationsSync, resumeSync, chatRead })
}

export const PlaywrightBrowserExecutor = {
  layer: (options: PlaywrightOptions = {}) =>
    Layer.succeed(BrowserExecutor)(makePlaywrightExecutor(options))
}
