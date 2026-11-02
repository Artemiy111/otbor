import type { ApiError } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  proxyForUrl
} from "@otbor/crawler"
import { extractEmployer } from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as EmployerRepository from "../repositories/EmployerRepository.ts"

export interface EmployerHydrationOptions {
  readonly limit?: number
  readonly delayMs?: number
}

export interface EmployerHydrationResult {
  readonly processed: number
  readonly updated: number
  readonly failed: number
  readonly errors: ReadonlyArray<string>
}

export interface EmployerHydratorShape {
  readonly run: (
    userId: string,
    options?: EmployerHydrationOptions
  ) => Effect.Effect<EmployerHydrationResult, ApiError>
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

      const prepareProxy = Effect.fn("EmployerHydrator.prepareProxy")(function*() {
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

      const run = Effect.fn("EmployerHydrator.run")(function*(
        _userId: string,
        options: EmployerHydrationOptions = {}
      ) {
        const limit = Math.min(Math.max(options.limit ?? 25, 1), 200)
        const delayMs = Math.max(0, options.delayMs ?? 750)
        const config = yield* prepareProxy()

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

        for (const [index, target] of targets.entries()) {
          processed += 1
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
              if (errors.length < 5) {
                errors.push(error instanceof Error ? error.message : String(error))
              }
              return Effect.succeed(null)
            })
          )

          if (patch === null) {
            failed += 1
          } else {
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
                    if (errors.length < 5) {
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
            if (saved) updated += 1
            else failed += 1
          }

          if (delayMs > 0 && index < targets.length - 1) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }

        if (processed > 0) {
          yield* Effect.logInfo(
            `employer hydration: ${updated}/${processed} updated, ${failed} failed`
          )
        }

        return { processed, updated, failed, errors }
      })

      return EmployerHydrator.of({ run })
    })
  )
}
