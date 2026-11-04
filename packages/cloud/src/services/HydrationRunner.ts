import type { ApiError, ProxyMode } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  classifyCrawlBlock,
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  proxyForUrl,
  proxyLabel,
  type ProxyConfig
} from "@otbor/crawler"
import { extractVacancy } from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CorpusService } from "./CorpusService.ts"
import { externalIdFromReference, vacancyPageUrl } from "./vacancyReference.ts"

export interface VacancyPage {
  readonly status: number
  readonly url: string
  readonly html: string
}

/** How a vacancy page is downloaded; replaced by a fixture in tests. */
export const VacancyPageFetch = Context.Reference<
  (url: string, proxy: string | null) => Promise<VacancyPage>
>("otbor/cloud/VacancyPageFetch", {
  defaultValue: () => (url, proxy) => fetchHtml(url, { proxy })
})

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
}

export interface HydrationRunnerShape {
  readonly run: (
    userId: string,
    options?: HydrationRunOptions
  ) => Effect.Effect<HydrationRunResult, ApiError>
  readonly hydrateOne: (
    userId: string,
    id: string,
    proxyMode?: ProxyMode
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

      const run = Effect.fn("HydrationRunner.run")(function*(
        userId: string,
        options: HydrationRunOptions = {}
      ) {
        const proxyMode = options.proxyMode ?? "auto"
        const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
        const delayMs = Math.max(0, options.delayMs ?? 1000)
        const config = yield* prepareProxy(proxyMode)
        const proxy = proxyState(proxyMode, config)

        const targets = yield* database
          .asUser(userId, (tx) =>
            VacancyRepository.listNeedingHydration(tx, { limit })
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
        const errors: string[] = []
        const vacancyIds = new Set<string>()

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
                ...proxy
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("vacancy hydration progress could not be persisted", cause))
              )

        for (const [index, target] of targets.entries()) {
          processed += 1

          const draft = yield* Effect.gen(function*() {
            const proxy = yield* Effect.try({
              try: () => proxyForUrl(config, target.canonicalUrl),
              catch: (error) =>
                new InvalidInput({
                  message: error instanceof Error ? error.message : String(error)
                })
            })

            const response = yield* Effect.tryPromise({
              try: () =>
                fetchHtml(target.canonicalUrl, {
                  proxy
                }),
              catch: (error) =>
                new InvalidInput({
                  message: `fetch ${target.canonicalUrl}: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                })
            })

            if (response.status !== 200) {
              return yield* new InvalidInput({
                message: `fetch ${target.canonicalUrl}: HTTP ${response.status}`
              })
            }

            return yield* extractVacancy(response.html, {
              url: response.url || target.canonicalUrl
            }).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidInput({
                    message: `parse ${target.canonicalUrl}: ${error.message}`
                  })
              )
            )
          }).pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              if (errors.length < 5) {
                errors.push(
                  error instanceof Error ? error.message : String(error)
                )
              }
              return Effect.succeed(null)
            })
          )

          if (draft === null) {
            failed += 1
          } else {
            const saved = yield* corpus.ingest([draft], { userId }).pipe(
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause)
                if (errors.length < 5) {
                  errors.push(
                    `ingest ${target.externalId}: ${
                      error instanceof Error ? error.message : String(error)
                    }`
                  )
                }
                return Effect.succeed(null)
              })
            )
            if (saved === null) {
              failed += 1
            } else {
              hydrated += 1
              for (const item of saved.items) vacancyIds.add(item.id)
              inserted += saved.inserted
              updated += saved.updated
              skipped += saved.skipped
            }
          }

          yield* reportProgress(target.title)

          if (delayMs > 0 && index < targets.length - 1) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }

        if (processed > 0) {
          yield* Effect.logInfo(
            `vacancy hydration: ${hydrated}/${processed} hydrated, ${failed} failed`
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
          ...proxy
        }
      })

      const hydrateOne = Effect.fn("HydrationRunner.hydrateOne")(function*(
        userId: string,
        id: string,
        proxyMode: ProxyMode = "auto"
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
          !VacancyRepository.needsHydration({
            descriptionHtml: row.descriptionHtml,
            descriptionText: row.descriptionText
          })
        ) {
          return false
        }

        const success = yield* Effect.gen(function*() {
          const proxy = yield* Effect.try({
            try: () => proxyForUrl(config, row.canonicalUrl),
            catch: (error) =>
              new InvalidInput({
                message: error instanceof Error ? error.message : String(error)
              })
          })

          const response = yield* Effect.tryPromise({
            try: () =>
              fetchHtml(row.canonicalUrl, {
                proxy
              }),
            catch: (error) =>
              new InvalidInput({
                message: `fetch ${row.canonicalUrl}: ${
                  error instanceof Error ? error.message : String(error)
                }`
              })
          })

          if (response.status !== 200) {
            return yield* new InvalidInput({
              message: `fetch ${row.canonicalUrl}: HTTP ${response.status}`
            })
          }

          const draft = yield* extractVacancy(response.html, {
            url: response.url || row.canonicalUrl
          }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidInput({
                  message: `parse ${row.canonicalUrl}: ${error.message}`
                })
            )
          )

          yield* corpus.ingest([draft], { userId }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidInput({
                  message: `ingest ${row.externalId}: ${error.message}`
                })
            )
          )

          return true
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.logWarning(
              `vacancy hydrate failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            ).pipe(Effect.as(false))
          })
        )

        if (success) {
          yield* Effect.logInfo(`vacancy hydrated: ${row.externalId}`)
        }

        return success
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
        const fetchPage = yield* VacancyPageFetch
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
        if (response.status !== 200) {
          return yield* new InvalidInput({ message: `fetch ${url}: HTTP ${response.status}` })
        }
        const block = classifyCrawlBlock(response.status, response.html)
        if (block !== null) {
          return yield* new InvalidInput({ message: `fetch ${url}: hh.ru answered with ${String(block)}` })
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