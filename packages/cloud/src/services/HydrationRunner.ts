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

      const rememberShortPage = (target: VacancyTargetLike) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordDeferred(tx, {
              kind: "vacancy",
              id: target.id,
              externalId: target.externalId
            }, HYDRATION_STUB_RECHECK_SECONDS, "страница без полного описания")
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`vacancy hydration deferral was not recorded for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

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
        // required, test, schedule) on vacancies hydrated before they were read.
        const targets = yield* database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              const stubs = yield* VacancyRepository.listNeedingHydration(tx, {
                limit,
                onlyDue: true
              })
              if (stubs.length >= limit) return stubs
              const backfill = yield* VacancyRepository.listNeedingHydration(tx, {
                limit: limit - stubs.length,
                onlyDue: true,
                missingHhSignals: true
              })
              return [...stubs, ...backfill]
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

        for (const [index, target] of targets.entries()) {
          processed += 1

          const download = yield* downloadVacancy(target, config)
          rotations += download.rotations
          const outcome = download.outcome

          if (outcome.kind === "blocked") {
            failed += 1
            pushError(outcome.message)
            stoppedBy = outcome.block
            yield* rememberFailure(target, outcome.message)
            yield* reportProgress(target.title)
            break
          }

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
              if (outcome.stillStub) yield* rememberShortPage(target)
              else yield* rememberSuccess(target)
            }
          }

          yield* reportProgress(target.title)

          if (delayMs > 0 && index < targets.length - 1) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }

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

        if (outcome.stillStub) yield* rememberShortPage(target)
        else yield* rememberSuccess(target)
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
        const response = yield* Effect.tryPromise({
          try: () => fetchPage(url, proxy),
          catch: (error) =>
            new InvalidInput({
              message: `fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
            })
        })
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
