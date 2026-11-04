import type { ApiError, EmployerHydrationTarget, ProxyMode } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  proxyForUrl,
  proxyLabel,
  type ProxyConfig
} from "@otbor/crawler"
import { extractEmployer } from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as EmployerRepository from "../repositories/EmployerRepository.ts"

/** Safe, JSON-shaped progress snapshot written to `schedule_run.detail`. */
export interface EmployerHydrationProgress {
  readonly processed: number
  readonly target: number
  readonly updated: number
  readonly failed: number
  readonly currentName: string | null
  readonly errors: ReadonlyArray<string>
  readonly proxyMode: ProxyMode
  readonly proxy: string
  readonly proxySource: ProxyConfig["source"] | null
}

export interface EmployerHydrationOptions {
  readonly limit?: number
  readonly delayMs?: number
  /** How hh requests choose between the configured proxy and going direct. */
  readonly proxyMode?: ProxyMode
  /** Written after every item; failures are logged and progress continues. */
  readonly onProgress?: (progress: EmployerHydrationProgress) => Effect.Effect<void>
}

export interface EmployerHydrationResult {
  readonly processed: number
  readonly updated: number
  readonly failed: number
  readonly errors: ReadonlyArray<string>
  readonly proxyMode: ProxyMode
  readonly proxy: string
  readonly proxySource: ProxyConfig["source"] | null
  readonly target: number
}

export interface EmployerHydratorShape {
  readonly run: (
    userId: string,
    options?: EmployerHydrationOptions
  ) => Effect.Effect<EmployerHydrationResult, ApiError>
  readonly hydrateOne: (
    userId: string,
    id: string,
    proxyMode?: ProxyMode
  ) => Effect.Effect<boolean, ApiError>
}

/**
 * `employer_hydration` schedule: refresh a bounded slice of employer profiles.
 * Only employers that back a vacancy are touched, oldest profile first. A page
 * that cannot be parsed is an error for that employer and the pass continues.
 */
export class EmployerHydrator extends Context.Service<
  EmployerHydrator,
  EmployerHydratorShape
>()("otbor/cloud/EmployerHydrator") {
  static readonly layer = Layer.effect(
    EmployerHydrator,
    Effect.gen(function*() {
      const database = yield* Database

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

      const hydrateTarget = (
        target: EmployerHydrationTarget,
        config: ProxyConfig | null,
        errors?: string[]
      ) =>
        Effect.gen(function*() {
          const pageUrl = `https://hh.ru/employer/${target.externalId}`

          const patch = yield* Effect.gen(function*() {
            const proxy = yield* Effect.try({
              try: () => proxyForUrl(config, pageUrl),
              catch: (error) =>
                new InvalidInput({
                  message: error instanceof Error ? error.message : String(error)
                })
            })
            const response = yield* Effect.tryPromise({
              try: () => fetchHtml(pageUrl, { proxy }),
              catch: (error) =>
                new InvalidInput({
                  message: `fetch ${pageUrl}: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                })
            })
            if (response.status !== 200) {
              return yield* new InvalidInput({
                message: `fetch ${pageUrl}: HTTP ${response.status}`
              })
            }
            return yield* extractEmployer(response.html, {
              externalId: target.externalId,
              url: pageUrl
            }).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidInput({
                    message: `parse ${pageUrl}: ${error.message}`
                  })
              )
            )
          }).pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              if (errors !== undefined && errors.length < 5) {
                errors.push(error instanceof Error ? error.message : String(error))
              }
              return Effect.succeed(null)
            })
          )

          if (patch === null) return false

          const saved = yield* database
            .asOwner((tx) =>
              EmployerRepository.applyProfile(tx, target.id, {
                name: patch.name,
                rating: patch.rating,
                reviewsCount: patch.reviewsCount,
                recommendationsPercent: patch.recommendationsPercent,
                siteUrl: patch.siteUrl,
                logoUrl: patch.logoUrl,
                industries: patch.industries
              })
            )
            .pipe(
              Effect.match({
                onFailure: (error: unknown) => {
                  if (errors !== undefined && errors.length < 5) {
                    errors.push(
                      `update ${target.externalId}: ${
                        error instanceof Error ? error.message : String(error)
                      }`
                    )
                  }
                  return false
                },
                onSuccess: () => true
              })
            )
          return saved
        })

      const run = Effect.fn("EmployerHydrator.run")(function*(
        _userId: string,
        options: EmployerHydrationOptions = {}
      ) {
        const proxyMode = options.proxyMode ?? "auto"
        const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
        const delayMs = Math.max(0, options.delayMs ?? 750)
        const config = yield* prepareProxy(proxyMode)
        const proxy = proxyState(proxyMode, config)

        // The corpus is shared, and only the owner may update it.
        const targets = yield* database
          .asOwner((tx) => EmployerRepository.listForRefresh(tx, { limit }))
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidInput({
                  message: `employer refresh list: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`
                })
            )
          )

        let processed = 0
        let updated = 0
        let failed = 0
        const errors: string[] = []

        const reportProgress = (currentName: string | null) =>
          options.onProgress === undefined
            ? Effect.void
            : options.onProgress({
                processed,
                target: targets.length,
                updated,
                failed,
                currentName,
                errors: [...errors],
                ...proxy
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("employer hydration progress could not be persisted", cause))
              )

        for (const [index, target] of targets.entries()) {
          processed += 1
          if (yield* hydrateTarget(target, config, errors)) updated += 1
          else failed += 1
          yield* reportProgress(target.name)

          if (delayMs > 0 && index < targets.length - 1) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }

        if (processed > 0) {
          yield* Effect.logInfo(
            `employer hydration: ${updated}/${processed} updated, ${failed} failed`
          )
        }

        return { processed, target: targets.length, updated, failed, errors, ...proxy }
      })

      const hydrateOne = Effect.fn("EmployerHydrator.hydrateOne")(function*(
        _userId: string,
        id: string,
        proxyMode: ProxyMode = "auto"
      ) {
        const config = yield* prepareProxy(proxyMode)
        const target = yield* database
          .asOwner((tx) => EmployerRepository.findTargetById(tx, id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new InvalidInput({
                  message: `employer load ${id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`
                })
            )
          )

        if (target === null) {
          return yield* new NotFound({ entity: "Employer", id })
        }

        const ok = yield* hydrateTarget(target, config)
        if (ok) yield* Effect.logInfo(`employer hydrated: ${target.externalId}`)
        return ok
      })

      return EmployerHydrator.of({ run, hydrateOne })
    })
  )
}
