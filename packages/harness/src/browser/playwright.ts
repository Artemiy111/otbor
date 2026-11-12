import type {
  HarnessExit,
  NegotiationsSyncJobPayload,
  FormReadJobPayload,
  LetterAttachJobPayload,
  ReconcileJobPayload,
  ChatReadJobPayload,
  ResumeBumpEvidence,
  ResumeSyncJobPayload,
  ReconcilePage,
  SubmitEvidence
} from "@otbor/contract"
import { isTrackerUrl } from "./trackers.ts"
import { BUMP_BUTTON_SELECTOR, BUMP_PAYWALL_SELECTOR, decideBump, normalizeBumpText, parseLastBump, classifyResponsePage, parseResumeRefs, readResponseStatus, isOnlyOfferedResume, responseResumeHash } from "@otbor/hh"
import { Effect, Layer, Schema, Semaphore } from "effect"
import { existsSync } from "node:fs"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
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
  contactsWindow,
  chatDataUrl,
  chatReadExit,
  bumpUnclicked,
  resumeBumpExit,
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
import { BrowserExecutor, type LetterAttachRequest, type ResumeBumpRequest, type SubmitRequest } from "./executor.ts"
import { makeCaptchaSolve, type CaptchaSolve } from "./captcha.ts"
import { makeHumanizer, noHumanizer } from "./humanize.ts"
import { DEFAULT_CHROME_PATH } from "./profile.ts"
import { fileSessionStore, type LoadedSession, type SessionStore } from "./sessionStore.ts"

export class BrowserError extends Schema.TaggedError<BrowserError>()("BrowserError", {
  message: Schema.String
}) {}

export interface PlaywrightOptions {
  /** hh origin. Tests point this at a local server; production keeps the default. */
  readonly baseUrl?: string
  /**
   * Корень локальных файлов `storage-state.json`, если `sessions` не задан.
   * По умолчанию `~/.otbor/hh/accounts`.
   */
  readonly profilesDir?: string
  /** Откуда брать и куда возвращать cookies аккаунта. По умолчанию локальный файл. */
  readonly sessions?: SessionStore
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
   * По умолчанию столько, сколько харнесс вообще держит потоков: потолок и темп
   * задаёт облако (настройки пользователя), и он меняется на лету, а здесь
   * значение зафиксировано при старте. Меньшее число - явная страховка
   * (`OTBOR_HARNESS_ACCOUNT_SUBMIT_CONCURRENCY`).
   */
  readonly accountActingConcurrency?: number
  /** Сколько времени человеческая разминка автоотклика может добавить к задаче. */
  readonly humanizeBudgetMs?: number
  /** Источник случайности разминки; в тестах подменяется. */
  readonly humanizeRandom?: () => number
  /**
   * Папка для отладочных скриншотов капчи (абсолютный путь). По умолчанию
   * `~/.otbor/captcha-shots` или `OTBOR_CAPTCHA_SHOTS_DIR`; `null` выключает.
   */
  readonly captchaShotsDir?: string | null
  /**
   * Папка следов страницы (абсолютный путь): HTML и снимок экрана того, что
   * hh показал, когда задача закончилась неудачей. По умолчанию
   * `~/.otbor/page-traces` или `OTBOR_PAGE_TRACES_DIR`; `null` или `off` выключает.
   */
  readonly pageTracesDir?: string | null
  /**
   * Решатель капчи (локальная модель читает картинку). По умолчанию берёт
   * настройки из `~/.otbor/captcha.json`; в тестах подменяется.
   */
  readonly captchaSolve?: CaptchaSolve
}

const defaultCaptchaShotsDir = (): string | null => {
  const override = process.env.OTBOR_CAPTCHA_SHOTS_DIR?.trim()
  if (override === "off") return null
  return override !== undefined && override !== "" ? override : join(homedir(), ".otbor", "captcha-shots")
}

const defaultPageTracesDir = (): string | null => {
  const override = process.env.OTBOR_PAGE_TRACES_DIR?.trim()
  if (override === "off") return null
  return override !== undefined && override !== "" ? override : join(homedir(), ".otbor", "page-traces")
}

/**
 * Исходы, после которых полезно видеть страницу: hh показал не то, чего ждал
 * исполнитель. Капча снимается отдельно (`withCaptchaShot`), обрыв связи и
 * успешные исходы следа не оставляют.
 */
const TRACED_EXITS: ReadonlySet<string> = new Set([
  "blocked",
  "answer_rejected",
  "ambiguous",
  "form_changed",
  "resume_mismatch",
  "site_rejected",
  "not_submitted"
])

/** Сколько файлов следов держим в папке; старые удаляются. */
const PAGE_TRACES_KEEP = 300

const defaults = {
  baseUrl: "https://hh.ru",
  navigationTimeoutMs: 30_000,
  settleMs: 12_000,
  afterClickMs: 25_000,
  accountActingConcurrency: 12,
  humanizeBudgetMs: 5_000
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

  const solveCaptcha: CaptchaSolve = config.captchaSolve ?? makeCaptchaSolve()

  /** Куда класть скриншоты капчи; `null` выключает их. */
  const shotsDir = config.captchaShotsDir === undefined ? defaultCaptchaShotsDir() : config.captchaShotsDir

  /** Куда класть следы страницы при неудачном исходе; `null` выключает их. */
  const tracesDir = config.pageTracesDir === undefined ? defaultPageTracesDir() : config.pageTracesDir

  /**
   * Cookies аккаунта берутся из хранилища на каждую задачу, а Chrome один на
   * весь харнесс: профиля на диске нет, поэтому блокировать нечего, и две задачи
   * одного аккаунта (или два харнесса) не мешают друг другу.
   */
  const sessions: SessionStore =
    config.sessions ??
    fileSessionStore(config.profilesDir === undefined ? process.env : { OTBOR_HH_PROFILES_DIR: config.profilesDir })

  const exclusive = new Map<string, Semaphore.Semaphore>()

  let browser: Promise<Browser> | null = null
  const getBrowser = (): Promise<Browser> => {
    if (browser === null) {
      const launched = chromium.launch({
        headless: config.headless ?? true,
        ...(executablePath === undefined ? {} : { executablePath }),
        ignoreDefaultArgs: ["--no-sandbox"]
      })
      browser = launched
      // Упавший или закрытый браузер при следующей задаче запускается заново.
      launched.then(
        (opened) => opened.on("disconnected", () => { if (browser === launched) browser = null }),
        () => { if (browser === launched) browser = null }
      )
    }
    return browser
  }

  /** Сравнение cookies без шума: `expires` и порядок не считаются изменением. */
  const fingerprint = (state: string): string => {
    try {
      const parsed = JSON.parse(state) as { cookies?: ReadonlyArray<{ name: string; value: string; domain: string; path: string }> }
      return JSON.stringify(
        (parsed.cookies ?? [])
          .map((c) => `${c.domain}|${c.path}|${c.name}=${c.value}`)
          .sort()
      )
    } catch {
      return state
    }
  }

  const openContext = async (profile: string | null | undefined): Promise<{ context: BrowserContext; loaded: LoadedSession | null }> => {
    const name = (profile ?? "").trim() === "" ? "default" : (profile as string)
    const loaded = await sessions.load(name)
    const opened = await getBrowser()
    const context = await opened.newContext(
      loaded === null ? {} : { storageState: JSON.parse(loaded.state) }
    )
    // Analytics and ad beacons only slow hh's pages down.
    await context.route(
      (url) => isTrackerUrl(url.href),
      (route) => route.abort()
    )
    return { context, loaded }
  }

  /** Возвращает обновлённые cookies, только если они изменились. Сбой записи задачу не ломает. */
  const closeContext = async (
    profile: string | null | undefined,
    context: BrowserContext,
    loaded: LoadedSession | null
  ): Promise<void> => {
    const name = (profile ?? "").trim() === "" ? "default" : (profile as string)
    try {
      const state = JSON.stringify(await context.storageState())
      if (loaded === null || fingerprint(state) !== fingerprint(loaded.state)) {
        await sessions.save(name, state, loaded?.version ?? null)
      }
    } catch {
      // Cookies обновятся при следующей задаче; эта уже выполнена.
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  /**
   * Отладочный скриншот капчи: если задача закончилась выходом `captcha`, пока
   * страница ещё открыта, снимает её целиком в `captchaShotsDir` и дописывает
   * путь в сообщение выхода. Сбой снимка ничего не ломает: это только для отладки.
   * Позже файлы можно выносить в S3, а здесь останется ссылка.
   */
  const withCaptchaShot = <A>(page: Page, label: string | undefined, result: A) =>
    Effect.gen(function*() {
      const exit = result as unknown as HarnessExit | undefined
      if (shotsDir === null || exit === undefined || exit === null || exit.tag !== "captcha") return result
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const safe = (label ?? "job").replace(/[^\w.-]+/g, "_")
      const path = join(shotsDir, `${stamp}-${safe}.png`)
      // Капче нужно время дорисоваться: ждём 3 с и снимаем только первый экран.
      yield* sleep(3_000)
      const saved = yield* attempt(async () => {
        await mkdir(shotsDir, { recursive: true })
        await page.screenshot({ path, fullPage: false, timeout: 10_000 })
        return path
      }).pipe(Effect.orElseSucceed(() => null as string | null))
      if (saved === null) return result
      // Сама картинка капчи отдельным файлом: так её видно крупно и без страницы.
      const pictureFile = path.replace(/\.png$/, "-picture.png")
      const picture = yield* attempt(async () => {
        await page.locator('[data-qa="account-captcha-picture"]').first().screenshot({
          path: pictureFile,
          timeout: 5_000
        })
        return pictureFile
      }).pipe(Effect.orElseSucceed(() => null as string | null))
      yield* Effect.logWarning(
        `captcha screenshot saved: ${saved}${picture === null ? "" : `, picture: ${picture}`} (${page.url()})`
      )
      const note = picture === null ? `screenshot: ${saved}` : `screenshot: ${saved}, picture: ${picture}`
      return { ...exit, message: `${exit.message ?? ""} (${note})`.trim() } as unknown as A
    })

  /**
   * След страницы: если задача закончилась исходом из `TRACED_EXITS`, пока
   * страница ещё открыта, сохраняет её HTML и снимок экрана в `tracesDir` и
   * кладёт пути в `artifacts.trace` / `artifacts.traceShot`. Так причину видно
   * на самой странице hh, а не по догадке из сообщения. Файлы остаются на этой
   * машине (в них имя и резюме владельца аккаунта); сбой записи ничего не ломает.
   */
  const withPageTrace = <A>(page: Page, label: string | undefined, result: A) =>
    Effect.gen(function*() {
      const exit = result as unknown as HarnessExit | undefined
      if (tracesDir === null || exit === undefined || exit === null || typeof exit !== "object") return result
      if (typeof exit.tag !== "string" || !TRACED_EXITS.has(exit.tag)) return result
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const safe = (label ?? "job").replace(/[^\w.-]+/g, "_")
      const base = join(tracesDir, `${stamp}-${safe}-${exit.tag}`)
      const html = yield* attempt(async () => {
        await mkdir(tracesDir, { recursive: true, mode: 0o700 })
        const text = `<!-- ${page.url()} | ${exit.tag} | ${(exit.message ?? "").replace(/--/g, "- -")} -->\n${await page.content()}`
        await writeFile(`${base}.html`, text, { mode: 0o600 })
        return `${base}.html`
      }).pipe(Effect.orElseSucceed(() => null as string | null))
      const shot = yield* attempt(async () => {
        await page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 10_000 })
        return `${base}.png`
      }).pipe(Effect.orElseSucceed(() => null as string | null))
      if (html === null && shot === null) return result
      // Папка не растёт без конца: остаются последние файлы (имена начинаются со времени).
      yield* attempt(async () => {
        const files = (await readdir(tracesDir)).filter((name) => /\.(html|png)$/.test(name)).sort()
        await Promise.all(files.slice(0, Math.max(0, files.length - PAGE_TRACES_KEEP)).map((name) => rm(join(tracesDir, name), { force: true })))
      }).pipe(Effect.ignore)
      yield* Effect.logWarning(`page trace saved: ${html ?? shot} (${exit.tag}, ${page.url()})`)
      return {
        ...exit,
        artifacts: {
          ...(exit.artifacts ?? {}),
          ...(html === null ? {} : { trace: html }),
          ...(shot === null ? {} : { traceShot: shot })
        }
      } as unknown as A
    })

  /**
   * Opens a page of the profile's browser, runs `use`, always closes the page and
   * releases the browser. Jobs that act on the account (everything but a form
   * read) делят пул разрешений профиля (`accountActingConcurrency`); читающие
   * задачи идут без ограничения.
   */
  const withPage = <A, E>(
    profile: string | null | undefined,
    use: (page: Page) => Effect.Effect<A, E>,
    options: { readonly parallel?: boolean; readonly label?: string } = {}
  ) => {
    const dir = (profile ?? "").trim() === "" ? "default" : (profile as string)
    const run = Effect.scoped(
      Effect.gen(function*() {
        const { context } = yield* Effect.acquireRelease(
          attempt(() => openContext(profile)).pipe(
            Effect.map((opened) => ({ ...opened, profile }))
          ),
          (opened) => Effect.promise(() => closeContext(opened.profile, opened.context, opened.loaded))
        )
        const page = yield* Effect.acquireRelease(
          attempt(() => context.newPage()),
          (opened) => Effect.promise(() => opened.close().catch(() => undefined))
        )
        const result = yield* use(page)
        return yield* withPageTrace(page, options.label, yield* withCaptchaShot(page, options.label, result))
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
      let deadline = Date.now() + timeoutMs
      let html = ""
      while (true) {
        const read = yield* content(page)
        if (read !== null) {
          html = read
          const kind = classifyResponsePage(html, page.url())
          // Капчу пробует решить локальная модель; ответ введён - читаем страницу заново.
          if (kind === "captcha" && (yield* solveCaptcha(page))) {
            deadline = Date.now() + timeoutMs
            continue
          }
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
        let html = yield* settle(page, config.settleMs)
        // Предупреждение о другой стране: оператор согласен его подтверждать
        // (hh может отправить отклик сразу, если у вакансии нет формы; тогда
        // страница станет «откликнулись», и облако считает вакансию занятой).
        if (classifyResponsePage(html, page.url()) === "relocation") {
          const confirmed = yield* attempt(() =>
            page.locator(RELOCATION_SELECTOR).first().click({ timeout: 5_000 })
          ).pipe(Effect.as(true), Effect.orElseSucceed(() => false))
          if (confirmed) {
            html = yield* settle(
              page,
              config.settleMs,
              (kind) => kind === "form" || kind === "responded" || kind === "captcha" || kind === "archived"
            )
          }
        }
        return prepareExit(html, page.url())
      }),
      { parallel: true, label: `form-${payload.externalId}` }
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
      }),
      { label: `letter-${payload.externalId}` }
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

    // Разминка только у автоотклика; бюджет общий на всю задачу.
    const human =
      payload.humanize === true && config.humanizeBudgetMs > 0
        ? makeHumanizer({
            budgetMs: config.humanizeBudgetMs,
            ...(config.humanizeRandom === undefined ? {} : { random: config.humanizeRandom })
          })
        : noHumanizer

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

        // Страница отклика открыта и форма на месте: сначала «осмотреться».
        yield* human.warmUp(page)

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

          /**
           * Когда hh предлагает одно резюме (у аккаунта оно одно либо остальными
           * на вакансию уже откликались), селекта с вариантами в форме нет:
           * выбирать нечего, отклик уйдёт с ним. Это видно по состоянию страницы,
           * а карточка выбранного резюме, если она есть, должна называть его же.
           */
          let single = false
          if ((yield* chosenHash()) !== hash) {
            yield* openSelect
            if (!(yield* waitOption)) {
              if (!isOnlyOfferedResume((yield* content(page)) ?? html, wantedId)) {
                return blockedWith(`the resume ${label} did not appear in hh's resume select`)
              }
              const card = yield* attempt(async () => {
                const shown = page.locator(RESUME_SELECTED_SELECTOR).first()
                return (await shown.count()) === 0 ? "" : ((await shown.innerText({ timeout: 2_000 })) ?? "")
              }).pipe(Effect.orElseSucceed(() => ""))
              const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase()
              if (wantedTitle !== "" && norm(card) !== "" && !norm(card).includes(norm(wantedTitle))) {
                return blockedWith(`the response form shows the resume "${norm(card).slice(0, 80)}" instead of ${label}`)
              }
              yield* closeSelect
              single = true
            } else {
              yield* attempt(() => option.first().click({ timeout: 5_000 }))
              yield* sleep(300)
            }
          }
          // Проверка по id: после клика выбранным должен быть вариант этого хэша.
          // Если список закрылся и вариантов в DOM нет, открываем его заново.
          let verified = single
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
        if (letter === "" && preflight.form.coverLetter === "required") {
          // Без письма hh форму не примет («Пожалуйста, введите сопроводительное
          // письмо»), а клик дал бы «не ясно, ушёл ли отклик». Не нажимаем.
          return {
            tag: "answer_rejected",
            message: "the form requires a cover letter but the kit has none",
            ...unclicked(lastUrl)
          } satisfies HarnessExit
        }
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

        // Подвести курсор к кнопке до проверки lease: сама проверка и клик
        // остаются вплотную друг к другу.
        const aim = yield* human.approach(page, submitButton)

        // The last look before the only click: is this lease still ours?
        if (!(yield* beforeClick)) {
          return { tag: "transport", message: "lease lost before the click", ...unclicked(lastUrl) } satisfies HarnessExit
        }

        // From here on the response may reach hh whatever happens next.
        clicked = true
        yield* attempt(() =>
          submitButton.click({ timeout: 10_000, noWaitAfter: true, ...(aim === undefined ? {} : { position: aim }) })
        )

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
      }),
      { label: `submit-${payload.externalId}` }
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
            let deadline = Date.now() + config.settleMs
            let html = ""
            while (true) {
              const read = yield* content(page)
              if (read !== null) {
                html = read
                const kind = classifyResponsePage(html, page.url())
                if (kind === "captcha" && (yield* solveCaptcha(page))) {
                  deadline = Date.now() + config.settleMs
                  continue
                }
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
      { parallel: true, label: `reconcile-${payload.externalId}` }
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
          let deadline = Date.now() + config.settleMs
          let html = ""
          while (true) {
            const read = yield* content(page)
            if (read !== null) {
              html = read
              const kind = classifyResponsePage(html, page.url())
              if (kind === "captcha" && (yield* solveCaptcha(page))) {
                deadline = Date.now() + config.settleMs
                continue
              }
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
      { parallel: true, label: "negotiations-sync" }
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
            let deadline = Date.now() + config.settleMs
            let html = ""
            while (true) {
              const got = yield* content(page)
              if (got !== null) {
                html = got
                const kind = classifyResponsePage(html, page.url())
                if (kind === "captcha" && (yield* solveCaptcha(page))) {
                  deadline = Date.now() + config.settleMs
                  continue
                }
                if (kind === "login" || kind === "captcha" || ready(html)) break
              }
              if (Date.now() >= deadline) break
              yield* sleep(250)
            }
            return { url: page.url(), html } satisfies ReconcilePage
          })

        const profile = yield* read(profileUrl(baseUrl), (html) => parseResumeRefs(html).length > 0)
        // Контакты читаем как видимый текст: блок рисуется на клиенте, поэтому
        // ждём его в пределах settleMs; сбой чтения не ломает синк резюме.
        const contactsDeadline = Date.now() + config.settleMs
        let profileContactsText: string | undefined
        while (true) {
          const bodyText = yield* attempt(() => page.evaluate("document.body.innerText") as Promise<string>).pipe(
            Effect.orElseSucceed(() => "")
          )
          profileContactsText = contactsWindow(bodyText)
          if (profileContactsText !== undefined || Date.now() >= contactsDeadline) break
          yield* sleep(250)
        }
        const refs = parseResumeRefs(profile.html)
        const limit = Math.min(payload.maxResumes ?? MAX_SYNC_RESUMES, MAX_SYNC_RESUMES)
        const resumes: Array<ReconcilePage> = []
        for (const ref of refs.slice(0, limit)) {
          yield* sleep(config.syncDelayMs ?? 1_500)
          resumes.push(yield* read(resumeUrl(baseUrl, ref.hash), (html) => html.includes("HH-Lux-InitialState")))
        }
        return resumeSyncExit(profile, resumes, profileContactsText)
      }),
      { parallel: true, label: "resume-sync" }
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

  /**
   * Нажимает «Поднять в поиске» на странице резюме не больше одного раза.
   * Нажимается только настоящая кнопка `resume-update-button` (правила в
   * `decideBump`); кнопка-реклама подписки не трогается никогда. Если после
   * нажатия что-то сломалось, выход `ambiguous`: второго нажатия не будет.
   */
  const resumeBump = ({ payload, beforeClick }: ResumeBumpRequest): Effect.Effect<HarnessExit> => {
    let clicked = false
    let lastUrl = resumeUrl(baseUrl, payload.hash)
    let label: string | null = null
    let before: string | null = null

    const view = (page: Page, selector: string) =>
      Effect.gen(function*() {
        const target = page.locator(selector).first()
        if ((yield* attempt(() => target.count())) === 0) return null
        const text = yield* attempt(() => target.textContent({ timeout: 5_000 }))
        const href = yield* attempt(() => target.getAttribute("href", { timeout: 5_000 }))
        const disabled = yield* attempt(() => target.getAttribute("disabled", { timeout: 5_000 }))
        const aria = yield* attempt(() => target.getAttribute("aria-disabled", { timeout: 5_000 }))
        return {
          label: text ?? "",
          href,
          disabled: disabled !== null || aria === "true"
        }
      })

    const cardText = (page: Page) =>
      attempt(() => page.locator("body").innerText({ timeout: 5_000 })).pipe(Effect.orElseSucceed(() => ""))

    const run = withPage(
      payload.sessionProfile,
      (page) =>
        Effect.gen(function*() {
          yield* attempt(() =>
            page.goto(lastUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs })
          )
          // Карточка рисуется на клиенте: ждём кнопку, но не дольше settleMs.
          let deadline = Date.now() + config.settleMs
          let paywallSince: number | null = null
          while (true) {
            const html = yield* content(page)
            if (html !== null) {
              const kind = classifyResponsePage(html, page.url())
              if (kind === "captcha" && (yield* solveCaptcha(page))) {
                deadline = Date.now() + config.settleMs
                continue
              }
              if (kind === "login" || kind === "captcha") break
            }
            if ((yield* attempt(() => page.locator(BUMP_BUTTON_SELECTOR).count())) > 0) break
            if ((yield* attempt(() => page.locator(BUMP_PAYWALL_SELECTOR).count())) > 0) {
              // Реклама видна, а настоящей кнопки нет: даём ей ещё немного времени.
              paywallSince ??= Date.now()
              if (Date.now() - paywallSince > 2_500) break
            }
            if (Date.now() >= deadline) break
            yield* sleep(250)
          }
          lastUrl = page.url()
          const html = (yield* content(page)) ?? ""
          const kind = classifyResponsePage(html, lastUrl)
          if (kind === "login") return bumpUnclicked(lastUrl, "session_expired", "hh redirected to the login page")
          if (kind === "captcha") return bumpUnclicked(lastUrl, "captcha", "hh asked for a captcha")

          before = parseLastBump(yield* cardText(page))
          const button = yield* view(page, BUMP_BUTTON_SELECTOR)
          const paywall = yield* view(page, BUMP_PAYWALL_SELECTOR)
          const decision = decideBump(button, paywall)
          label = button === null ? (paywall === null ? null : normalizeBumpText(paywall.label)) : normalizeBumpText(button.label)
          if (decision._tag === "unavailable") {
            return bumpUnclicked(lastUrl, "blocked", `bump not available: ${decision.label}`, {
              label,
              lastBump: before
            })
          }

          // Кнопка есть уже в серверной вёрстке, а обработчики клика вешаются после
          // гидрации: клик раньше неё уходит в пустоту. Ждём, пока страница затихнет.
          yield* attempt(() => page.waitForLoadState("networkidle", { timeout: 10_000 })).pipe(
            Effect.orElseSucceed(() => undefined)
          )
          yield* sleep(2_000)

          // Последний взгляд перед единственным нажатием: аренда ещё наша?
          if (!(yield* beforeClick)) {
            return bumpUnclicked(lastUrl, "transport", "lease lost before the click", { label, lastBump: before })
          }
          clicked = true
          // Диагностика: какие запросы уходят при клике и что лежит под курсором.
          const seenRequests: Array<string> = []
          const onResponse = (response: { request: () => { method: () => string }; url: () => string; status: () => number }) => {
            const method = response.request().method()
            if (method !== "GET") seenRequests.push(`${method} ${response.url().slice(0, 120)} ${response.status()}`)
          }
          page.on("response", onResponse)
          const probe = yield* attempt(() =>
            page.evaluate(
              `(() => {
                const node = document.querySelector('button[data-qa="resume-update-button"]')
                if (!node) return "no button"
                const box = node.getBoundingClientRect()
                const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
                return "top=" + (top ? top.tagName : "") + " inButton=" + node.contains(top)
              })()`
            ) as Promise<string>
          ).pipe(Effect.orElseSucceed(() => "probe failed"))
          yield* attempt(() => page.locator(BUMP_BUTTON_SELECTOR).first().click({ timeout: 5_000 }))

          // Ждём, пока карточка изменится или кнопка станет недоступной.
          const waitUntil = Date.now() + 15_000
          let after: string | null = before
          let unavailableAfter = false
          while (true) {
            yield* sleep(500)
            after = parseLastBump(yield* cardText(page))
            const now = yield* view(page, BUMP_BUTTON_SELECTOR)
            unavailableAfter = decideBump(now, null)._tag === "unavailable"
            if ((after !== null && after !== before) || unavailableAfter || Date.now() >= waitUntil) break
          }
          page.off("response", onResponse)
          yield* Effect.logInfo(`bump click: ${probe}; requests: ${seenRequests.join(" | ") || "none"}`)
          // Подъём не подтвердился: снимаем страницу, чтобы увидеть, что осталось после клика.
          if (shotsDir !== null && !unavailableAfter && (after === null || after === before)) {
            const shot = join(shotsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-bump-${payload.hash}.png`)
            const saved = yield* attempt(async () => {
              await mkdir(shotsDir, { recursive: true })
              await page.screenshot({ path: shot, fullPage: false, timeout: 10_000 })
              return shot
            }).pipe(Effect.orElseSucceed(() => null as string | null))
            if (saved !== null) yield* Effect.logWarning(`bump not confirmed, screenshot: ${saved}`)
          }
          const evidence: ResumeBumpEvidence = {
            clicked: true,
            label,
            lastBumpBefore: before,
            lastBumpAfter: after,
            unavailableAfter,
            url: page.url()
          }
          return resumeBumpExit(evidence)
        }),
      { label: `bump-${payload.hash}` }
    )

    const failed = (message: string): HarnessExit =>
      clicked
        ? {
            tag: "ambiguous",
            message: `browser failed after the click: ${message}`,
            artifacts: {
              clicked: true,
              label,
              lastBumpBefore: before,
              lastBumpAfter: before,
              url: lastUrl
            } satisfies ResumeBumpEvidence
          }
        : bumpUnclicked(lastUrl, "transport", message, { label, lastBump: before })

    return run.pipe(
      Effect.catch((error) => Effect.succeed(failed(error.message))),
      Effect.catchDefect((defect) => Effect.succeed(failed(String(defect))))
    )
  }

  return BrowserExecutor.of({ prepare, submit, attachLetter, reconcile, negotiationsSync, resumeSync, chatRead, resumeBump })
}

export const PlaywrightBrowserExecutor = {
  layer: (options: PlaywrightOptions = {}) =>
    Layer.succeed(BrowserExecutor)(makePlaywrightExecutor(options))
}
