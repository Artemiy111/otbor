import type { ApiError, ProxyMode, VacancyDraft } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  canRotate,
  classifyCrawlBlock,
  ensureEngine,
  loadProxyConfig,
  proxyForUrl,
  proxyLabel,
  type ProxyConfig
} from "@otbor/crawler"
import { extractVacancy } from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as HydrationAttemptRepository from "../repositories/HydrationAttemptRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CorpusService } from "./CorpusService.ts"
import { PageFetch, type PageResponse } from "./pageFetch.ts"
import { proxyWorkerCount, withProxyWorker } from "./proxyPool.ts"
import { ProxyRotator } from "./proxyRotator.ts"
import { externalIdFromReference, vacancyPageUrl } from "./vacancyReference.ts"

/** Kept for callers and tests that used the vacancy-specific name. */
export type VacancyPage = PageResponse
export const VacancyPageFetch = PageFetch

/**
 * Why hh refused a page. `rate_limit` is not part of `CrawlBlock` because the
 * search crawler gets status codes straight from `CrawlError`; hydration sees
 * a plain response and classifies it here.
 */
export type HydrationBlock = "captcha" | "auth" | "forbidden" | "geo" | "rate_limit"

/**
 * A page that parsed but still does not satisfy the stub rule (hh sometimes
 * serves a short description). Look again in six hours instead of every pass.
 */
export const HYDRATION_STUB_RECHECK_SECONDS = 6 * 60 * 60
/** A full page without a response count: hh may simply not show it, ask again tomorrow. */
export const HYDRATION_NO_COUNT_RECHECK_SECONDS = 24 * 60 * 60
/**
 * A 403 on one vacancy page normally means the vacancy is no longer public.
 * It goes to the end of the queue and is tried again (on another proxy node
 * when rotation is enabled) up to this many times in one pass.
 */
export const HYDRATION_FORBIDDEN_ATTEMPTS = 3
/** This many different vacancies in a row ending in 403 look like an IP ban, not dead pages. */
export const HYDRATION_FORBIDDEN_STREAK_STOP = 5

export interface FetchedVacancy {
  readonly vacancyId: string
  readonly externalId: string
  readonly title: string
  readonly alreadyKnown: boolean
}

export type HydrationProxyMode = ProxyMode

/** Safe, JSON-shaped progress snapshot written to `schedule_run.detail`. */
export interface HydrationProgress {
  readonly processed: number
  readonly target: number
  readonly hydrated: number
  readonly failed: number
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly currentTitle: string | null
  readonly errors: ReadonlyArray<string>
  readonly proxyMode: ProxyMode
  readonly proxy: string
  readonly proxySource: ProxyConfig["source"] | null
  /** Set when the pass stopped because hh refused to serve pages. */
  readonly stoppedBy: HydrationBlock | null
  readonly rotations: number
}

export interface HydrationRunOptions {
  /** How many stored stubs to fetch in this pass. */
  readonly limit?: number
  /** Pause between vacancy requests; hh is not a fan of bursts. */
  readonly delayMs?: number
  /** How hh requests choose between the configured proxy and going direct. */
  readonly proxyMode?: ProxyMode
  /** Written after every item; failures are logged and progress continues. */
  readonly onProgress?: (progress: HydrationProgress) => Effect.Effect<void>
}

export interface HydrationRunResult {
  readonly processed: number
  readonly hydrated: number
  readonly failed: number
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly errors: ReadonlyArray<string>
  /** Vacancies the pass re-saved, for the evaluation that follows. */
  readonly vacancyIds?: ReadonlyArray<string>
  readonly proxyMode: ProxyMode
  readonly proxy: string
  readonly proxySource: ProxyConfig["source"] | null
  readonly target: number
  /** Non-null when the pass ended early on a captcha, 403, 429 or geo block. */
  readonly stoppedBy: HydrationBlock | null
  readonly rotations: number
}

export interface HydrationRunnerShape {
  readonly run: (
    userId: string,
    options?: HydrationRunOptions
  ) => Effect.Effect<HydrationRunResult, ApiError>
  readonly hydrateOne: (
    userId: string,
    id: string,
    proxyMode?: ProxyMode,
    /** Fetch even when the stored text is complete (re-captures hh signals). */
    force?: boolean
  ) => Effect.Effect<boolean, ApiError>
  /**
   * Manual mode: make sure one vacancy (hh URL or external id) is in the
   * corpus. One GET of the public vacancy page; nothing else is requested.
   */
  readonly fetchByReference: (
    userId: string,
    reference: string
  ) => Effect.Effect<FetchedVacancy, ApiError>
}

interface VacancyTargetLike {
  readonly id: string
  readonly externalId: string
  readonly canonicalUrl: string
  readonly title: string
}

type TargetAttempt =
  | { readonly kind: "ok"; readonly draft: VacancyDraft; readonly stillStub: boolean }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "blocked"; readonly block: HydrationBlock; readonly message: string }

const classifyResponse = (status: number, html: string): HydrationBlock | null => {
  if (status === 429) return "rate_limit"
  return classifyCrawlBlock(status, html)
}

const blockLabel = (block: HydrationBlock): string =>
  block === "captcha"
    ? "капчей"
    : block === "auth"
      ? "требованием входа"
      : block === "geo"
        ? "HTTP 451 (геоблок)"
        : block === "rate_limit"
          ? "HTTP 429 (слишком много запросов)"
          : "HTTP 403"

const blockMessage = (url: string, block: HydrationBlock): string =>
  `fetch ${url}: hh.ru ответил ${blockLabel(block)}; проход остановлен`

const attemptFailure = (url: string, error: unknown): TargetAttempt => ({
  kind: "failed",
  message: `fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
})

/**
 * `vacancy_hydration` schedule: a bounded pass over stored search-card stubs.
 * It uses the same fetch/parse path as `otbor hydrate`, but takes the proxy
 * from the local secret store and never touches the search pages.
 */
export class HydrationRunner extends Context.Service<HydrationRunner, HydrationRunnerShape>()(
  "otbor/cloud/HydrationRunner"
) {
  static readonly layer = Layer.effect(
    HydrationRunner,
    Effect.gen(function*() {
      const database = yield* Database
      const corpus = yield* CorpusService

      const prepareProxy = (mode: ProxyMode = "auto") => Effect.gen(function*() {
        if (mode === "direct") return null

        const config = yield* Effect.try({
          try: () => loadProxyConfig(),
          catch: (error) =>
            new InvalidInput({
              message: `proxy config: ${error instanceof Error ? error.message : String(error)}`
            })
        })

        if (mode === "proxy" && config === null) {
          return yield* new InvalidInput({
            message: "Прокси для гидратации не настроен. Выполните `otbor proxy set` или выберите «Напрямую»."
          })
        }

        if (config !== null && config.source === "subscription") {
          yield* Effect.tryPromise({
            try: () => ensureEngine(config),
            catch: (error) =>
              new InvalidInput({
                message: `proxy engine: ${error instanceof Error ? error.message : String(error)}`
              })
          })
        }
        return config
      })

      const proxyState = (mode: ProxyMode, config: ProxyConfig | null) => ({
        proxyMode: mode,
        proxy: proxyLabel(config),
        proxySource: config?.source ?? null
      })

      const rememberFailure = (target: VacancyTargetLike, message: string) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordFailure(tx, {
              kind: "vacancy",
              id: target.id,
              externalId: target.externalId
            }, message)
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`vacancy hydration attempt was not recorded for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const rememberSuccess = (target: VacancyTargetLike) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordSuccess(tx, {
              kind: "vacancy",
              id: target.id,
              externalId: target.externalId
            })
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`vacancy hydration attempt was not cleared for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const rememberDeferred = (target: VacancyTargetLike, seconds: number, note: string) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordDeferred(tx, {
              kind: "vacancy",
              id: target.id,
              externalId: target.externalId
            }, seconds, note)
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`vacancy hydration deferral was not recorded for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const rememberShortPage = (target: VacancyTargetLike) =>
        rememberDeferred(target, HYDRATION_STUB_RECHECK_SECONDS, "страница без полного описания")

      /** Short page, a page without the response count, or a clean success. */
      const rememberOutcome = (
        target: VacancyTargetLike,
        outcome: { readonly stillStub: boolean; readonly draft: VacancyDraft }
      ) => {
        if (outcome.stillStub) return rememberShortPage(target)
        if (outcome.draft.responsesTotal == null) {
          return rememberDeferred(target, HYDRATION_NO_COUNT_RECHECK_SECONDS, "hh не показал число откликов")
        }
        return rememberSuccess(target)
      }

      const attemptVacancy = (
        target: VacancyTargetLike,
        config: ProxyConfig | null
      ): Effect.Effect<TargetAttempt> =>
        Effect.gen(function*() {
          const proxy = yield* Effect.try({
            try: () => proxyForUrl(config, target.canonicalUrl),
            catch: (error) =>
              new InvalidInput({
                message: error instanceof Error ? error.message : String(error)
              })
          })

          const fetchPage = yield* PageFetch
          const response = yield* Effect.tryPromise({
            try: () => fetchPage(target.canonicalUrl, proxy),
            catch: (error) => error
          })

          const block = classifyResponse(response.status, response.html)
          if (block !== null) {
            return {
              kind: "blocked" as const,
              block,
              message: blockMessage(target.canonicalUrl, block)
            }
          }
          if (response.status !== 200) {
            return {
              kind: "failed" as const,
              message: `fetch ${target.canonicalUrl}: HTTP ${response.status}`
            }
          }

          const draft = yield* extractVacancy(response.html, {
            url: response.url || target.canonicalUrl
          }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidInput({
                  message: `parse ${target.canonicalUrl}: ${error.message}`
                })
            )
          )

          // A redirect or a stale card must never overwrite another vacancy.
          if (draft.externalId !== target.externalId) {
            return {
              kind: "failed" as const,
              message:
                `fetch ${target.canonicalUrl}: страница вакансии ${draft.externalId}, ` +
                `ожидалась ${target.externalId}`
            }
          }

          return {
            kind: "ok" as const,
            draft,
            stillStub: VacancyRepository.needsHydration(draft)
          }
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.succeed(attemptFailure(target.canonicalUrl, error))
          })
        )

      const rotateOnce = (config: ProxyConfig | null): Effect.Effect<boolean> => {
        if (!canRotate(config)) return Effect.succeed(false)
        return Effect.flatMap(ProxyRotator, (rotate) =>
          Effect.tryPromise({
            try: () => rotate(config),
            catch: (error) => error
          })
        ).pipe(
          Effect.map((result) => result !== null),
          Effect.catchCause((cause) =>
            Effect.logWarning("proxy rotation failed; stopping the pass", cause).pipe(
              Effect.as(false)
            )
          )
        )
      }

      /**
       * One download, plus one retry after a proxy rotation when the operator
       * enabled it. Without rotation the caller stops the pass: the next target
       * would hit the same wall and burn the queue.
       */
      const downloadVacancy = (
        target: VacancyTargetLike,
        config: ProxyConfig | null
      ): Effect.Effect<{ readonly outcome: TargetAttempt; readonly rotations: number }> =>
        Effect.gen(function*() {
          let outcome = yield* attemptVacancy(target, config)
          if (outcome.kind !== "blocked") return { outcome, rotations: 0 }
          if (!(yield* rotateOnce(config))) return { outcome, rotations: 0 }
          outcome = yield* attemptVacancy(target, config)
          return { outcome, rotations: 1 }
        })

      const run = Effect.fn("HydrationRunner.run")(function*(
        userId: string,
        options: HydrationRunOptions = {}
      ) {
        const proxyMode = options.proxyMode ?? "auto"
        const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
        const delayMs = Math.max(0, options.delayMs ?? 1000)
        const config = yield* prepareProxy(proxyMode)
        const proxy = proxyState(proxyMode, config)

        // Stubs first; spare capacity backfills hh response signals (letter
        // required, test, schedule), then response counts, on vacancies
        // hydrated before they were read.
        const targets = yield* database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              const stubs = yield* VacancyRepository.listNeedingHydration(tx, {
                limit,
                onlyDue: true
              })
              if (stubs.length >= limit) return stubs
              const signals = yield* VacancyRepository.listNeedingHydration(tx, {
                limit: limit - stubs.length,
                onlyDue: true,
                missingHhSignals: true
              })
              const taken = stubs.length + signals.length
              if (taken >= limit) return [...stubs, ...signals]
              const counts = yield* VacancyRepository.listNeedingHydration(tx, {
                limit: limit - taken,
                onlyDue: true,
                missingResponses: true
              })
              const seen = new Set([...stubs, ...signals].map((item) => item.id))
              return [...stubs, ...signals, ...counts.filter((item) => !seen.has(item.id))]
            })
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidInput({
                  message: `vacancy hydration list: ${cause instanceof Error ? cause.message : String(cause)}`
                })
            )
          )

        let processed = 0
        let hydrated = 0
        let failed = 0
        let inserted = 0
        let updated = 0
        let skipped = 0
        let rotations = 0
        let stoppedBy: HydrationBlock | null = null
        const errors: string[] = []
        const vacancyIds = new Set<string>()

        const pushError = (message: string) => {
          if (errors.length < 5) errors.push(message)
        }

        const reportProgress = (currentTitle: string | null) =>
          options.onProgress === undefined
            ? Effect.void
            : options.onProgress({
                processed,
                target: targets.length,
                hydrated,
                failed,
                inserted,
                updated,
                skipped,
                currentTitle,
                errors: [...errors],
                stoppedBy,
                rotations,
                ...proxy
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("vacancy hydration progress could not be persisted", cause))
              )

        // Targets that hit a 403 go to the back and are tried again; the pass
        // only stops for a wall that is not about one page (captcha, login,
        // geo, 429) or when several different vacancies in a row stay 403.
        const queue = targets.map((target) => ({ target, forbidden: 0 }))
        let forbiddenStreak = 0
        let stop = false

        const drain = (worker: ProxyConfig | null) => Effect.gen(function*() {
        while (!stop && queue.length > 0) {
          const entry = queue.shift()!
          const target = entry.target

          const download = yield* downloadVacancy(target, worker)
          rotations += download.rotations
          const outcome = download.outcome

          if (outcome.kind === "blocked" && outcome.block === "forbidden") {
            entry.forbidden += 1
            if (entry.forbidden < HYDRATION_FORBIDDEN_ATTEMPTS) {
              // Another try later; downloadVacancy already switched the node when it can.
              queue.push(entry)
              yield* Effect.sleep(`${delayMs} millis`)
              continue
            }
            processed += 1
            failed += 1
            forbiddenStreak += 1
            const message =
              `fetch ${target.canonicalUrl}: HTTP 403, вакансия недоступна ` +
              `(${entry.forbidden} попытки)`
            pushError(message)
            yield* rememberFailure(target, message)
            if (forbiddenStreak >= HYDRATION_FORBIDDEN_STREAK_STOP) {
              stoppedBy = "forbidden"
              stop = true
              yield* reportProgress(target.title)
              break
            }
            yield* reportProgress(target.title)
            if (delayMs > 0 && queue.length > 0) yield* Effect.sleep(`${delayMs} millis`)
            continue
          }

          processed += 1

          if (outcome.kind === "blocked") {
            failed += 1
            pushError(outcome.message)
            stoppedBy = outcome.block
            stop = true
            yield* rememberFailure(target, outcome.message)
            yield* reportProgress(target.title)
            break
          }

          forbiddenStreak = 0

          if (outcome.kind === "failed") {
            failed += 1
            pushError(outcome.message)
            yield* rememberFailure(target, outcome.message)
          } else {
            const saved = yield* corpus.ingest([outcome.draft], { userId }).pipe(
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause)
                const message = `ingest ${target.externalId}: ${
                  error instanceof Error ? error.message : String(error)
                }`
                pushError(message)
                return Effect.succeed(null)
              })
            )
            if (saved === null) {
              failed += 1
              yield* rememberFailure(target, `ingest failed for ${target.externalId}`)
            } else {
              hydrated += 1
              for (const item of saved.items) vacancyIds.add(item.id)
              inserted += saved.inserted
              updated += saved.updated
              skipped += saved.skipped
              yield* rememberOutcome(target, outcome)
            }
          }

          yield* reportProgress(target.title)

          if (delayMs > 0 && queue.length > 0) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }
        })

        // One loop per worker; each has its own exit IP and rotates alone.
        const lanes = Math.max(1, Math.min(proxyWorkerCount(config), queue.length))
        yield* Effect.forEach(
          Array.from({ length: lanes }),
          () => withProxyWorker(config, drain),
          { concurrency: "unbounded", discard: true }
        )

        if (processed > 0) {
          yield* Effect.logInfo(
            `vacancy hydration: ${hydrated}/${processed} hydrated, ${failed} failed` +
              (stoppedBy === null ? "" : `, stopped by ${stoppedBy}`)
          )
        }

        return {
          processed,
          target: targets.length,
          hydrated,
          failed,
          inserted,
          updated,
          skipped,
          errors,
          vacancyIds: [...vacancyIds],
          stoppedBy,
          rotations,
          ...proxy
        }
      })

      const hydrateOne = Effect.fn("HydrationRunner.hydrateOne")(function*(
        userId: string,
        id: string,
        proxyMode: ProxyMode = "auto",
        force: boolean = false
      ) {
        const config = yield* prepareProxy(proxyMode)

        const row = yield* database
          .asUser(userId, (tx) => VacancyRepository.findById(tx, id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidInput({
                  message: `vacancy load ${id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`
                })
            )
          )

        if (row === null) {
          return yield* new InvalidInput({
            message: `vacancy not found: ${id}`
          })
        }

        if (
          !force &&
          !VacancyRepository.needsHydration({
            descriptionHtml: row.descriptionHtml,
            descriptionText: row.descriptionText
          })
        ) {
          return false
        }

        const target: VacancyTargetLike = {
          id: row.id,
          externalId: row.externalId,
          canonicalUrl: row.canonicalUrl,
          title: row.title
        }
        const { outcome } = yield* downloadVacancy(target, config)

        if (outcome.kind !== "ok") {
          yield* rememberFailure(target, outcome.message)
          yield* Effect.logWarning(`vacancy hydrate failed: ${outcome.message}`)
          return false
        }

        const saved = yield* corpus.ingest([outcome.draft], { userId }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.logWarning(
              `vacancy hydrate failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            ).pipe(Effect.as(false))
          })
        )

        if (!saved) {
          yield* rememberFailure(target, `ingest failed for ${target.externalId}`)
          return false
        }

        yield* rememberOutcome(target, outcome)
        yield* Effect.logInfo(`vacancy hydrated: ${row.externalId}`)
        return true
      })

      const fetchByReference = Effect.fn("HydrationRunner.fetchByReference")(function*(
        userId: string,
        reference: string
      ) {
        const externalId = externalIdFromReference(reference)
        if (externalId === null) {
          return yield* new InvalidInput({
            message: `cannot read "${reference}" as an hh.ru vacancy URL (https://hh.ru/vacancy/<id>) or external id`
          })
        }

        const known = yield* database
          .asUser(userId, (tx) => VacancyRepository.findByExternal(tx, "hh", externalId))
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidInput({
                  message: `vacancy lookup ${externalId}: ${cause instanceof Error ? cause.message : String(cause)}`
                })
            )
          )
        if (
          known !== null &&
          !VacancyRepository.needsHydration({
            descriptionHtml: known.descriptionHtml,
            descriptionText: known.descriptionText
          })
        ) {
          return { vacancyId: known.id, externalId, title: known.title, alreadyKnown: true }
        }

        // Looked up per call, so a test can swap the downloader for one request.
        const fetchPage = yield* PageFetch
        const config = yield* prepareProxy()
        const url = vacancyPageUrl(externalId)
        const proxy = yield* Effect.try({
          try: () => proxyForUrl(config, url),
          catch: (error) =>
            new InvalidInput({ message: error instanceof Error ? error.message : String(error) })
        })
        const download = (via: string | null) =>
          Effect.tryPromise({
            try: () => fetchPage(url, via),
            catch: (error) =>
              new InvalidInput({
                message: `fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
              })
          })
        // One public page on demand. A proxy that does not answer at all (a
        // connection error, not an hh answer) falls back to a direct request;
        // a block page or a bad status is never retried around the proxy.
        const response = yield* download(proxy).pipe(
          Effect.catch((error) =>
            proxy === null
              ? Effect.fail(error)
              : Effect.logWarning(`${error.message}; trying ${url} without the proxy`).pipe(
                  Effect.andThen(download(null))
                )
          )
        )
        const block = classifyResponse(response.status, response.html)
        if (block !== null) {
          return yield* new InvalidInput({ message: blockMessage(url, block) })
        }
        if (response.status !== 200) {
          return yield* new InvalidInput({ message: `fetch ${url}: HTTP ${response.status}` })
        }
        const draft = yield* extractVacancy(response.html, { url: response.url || url }).pipe(
          Effect.mapError((error) => new InvalidInput({ message: `parse ${url}: ${error.message}` }))
        )
        if (draft.externalId !== externalId) {
          return yield* new InvalidInput({
            message: `fetch ${url}: the page is vacancy ${draft.externalId}, not ${externalId}`
          })
        }
        const saved = yield* corpus.ingest([draft], { userId })
        const item = saved.items[0]
        if (item === undefined) {
          return yield* new InvalidInput({ message: `ingest ${externalId}: nothing was stored` })
        }
        yield* Effect.logInfo(`vacancy fetched on demand: ${externalId}`)
        return { vacancyId: item.id, externalId, title: item.title, alreadyKnown: known !== null }
      })

      return HydrationRunner.of({ run, hydrateOne, fetchByReference })
    })
  )
}
