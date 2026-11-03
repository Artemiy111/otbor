import type { ApiError } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  proxyForUrl
} from "@otbor/crawler"
import { extractVacancy } from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CorpusService } from "./CorpusService.ts"

export interface HydrationRunOptions {
  /** How many stored stubs to fetch in this pass. */
  readonly limit?: number
  /** Pause between vacancy requests; hh is not a fan of bursts. */
  readonly delayMs?: number
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
}

export interface HydrationRunnerShape {
  readonly run: (
    userId: string,
    options?: HydrationRunOptions
  ) => Effect.Effect<HydrationRunResult, ApiError>
  readonly hydrateOne: (
    userId: string,
    id: string
  ) => Effect.Effect<boolean, ApiError>
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

      const prepareProxy = Effect.fn("HydrationRunner.prepareProxy")(function*() {
        const config = yield* Effect.try({
          try: () => loadProxyConfig(),
          catch: (error) =>
            new InvalidInput({
              message: `proxy config: ${error instanceof Error ? error.message : String(error)}`
            })
        })

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

      const run = Effect.fn("HydrationRunner.run")(function*(
        userId: string,
        options: HydrationRunOptions = {}
      ) {
        const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
        const delayMs = Math.max(0, options.delayMs ?? 1000)
        const config = yield* prepareProxy()

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
          hydrated,
          failed,
          inserted,
          updated,
          skipped,
          errors,
          vacancyIds: [...vacancyIds]
        }
      })

      const hydrateOne = Effect.fn("HydrationRunner.hydrateOne")(function*(
        userId: string,
        id: string
      ) {
        const config = yield* prepareProxy()

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

      return HydrationRunner.of({ run, hydrateOne })
    })
  )
}