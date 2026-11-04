import type { ApiError, EmployerHydrationTarget, ProxyMode } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import {
  canRotate,
  classifyCrawlBlock,
  ensureEngine,
  loadProxyConfig,
  proxyForUrl,
  proxyLabel,
  type ProxyConfig
} from "@otbor/crawler"
import {
  employerReviewsWidgetUrl,
  extractEmployer,
  parseEmployerReviewsWidget,
  type EmployerProfileDraft
} from "@otbor/hh"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as EmployerRepository from "../repositories/EmployerRepository.ts"
import * as HydrationAttemptRepository from "../repositories/HydrationAttemptRepository.ts"
import { PageFetch } from "./pageFetch.ts"
import { ProxyRotator } from "./proxyRotator.ts"

export type EmployerHydrationBlock = "captcha" | "auth" | "forbidden" | "geo" | "rate_limit"

/** Same six-hour recheck as vacancies: parsed, but still missing fields. */
export const EMPLOYER_RECHECK_SECONDS = 6 * 60 * 60

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
  readonly stoppedBy: EmployerHydrationBlock | null
  readonly rotations: number
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
  /** Non-null when the pass ended early on a captcha, 403, 429 or geo block. */
  readonly stoppedBy: EmployerHydrationBlock | null
  readonly rotations: number
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
 * Fields the stored profile lacked that the freshly parsed page still does
 * not provide. `missing` alone only describes the old row: a page that filled
 * everything must clear the retry debt immediately.
 */
const stillMissingAfter = (
  target: EmployerHydrationTarget,
  patch: EmployerProfileDraft
): boolean =>
  target.missing.some((field) =>
    field === "rating"
      ? patch.rating === null
      : field === "siteUrl"
        ? patch.siteUrl === null
        : field === "logoUrl"
          ? patch.logoUrl === null
          : patch.industries.length === 0
  )

const EMPLOYER_PATH_RE = /\/employer\/(\d+)/

/** The id hh redirected us to, if the URL names an employer at all. */
export const employerIdFromUrl = (url: string): string | null =>
  EMPLOYER_PATH_RE.exec(url)?.[1] ?? null

const classifyResponse = (status: number, html: string): EmployerHydrationBlock | null => {
  if (status === 429) return "rate_limit"
  return classifyCrawlBlock(status, html)
}

const blockLabel = (block: EmployerHydrationBlock): string =>
  block === "captcha"
    ? "капчей"
    : block === "auth"
      ? "требованием входа"
      : block === "geo"
        ? "HTTP 451 (геоблок)"
        : block === "rate_limit"
          ? "HTTP 429 (слишком много запросов)"
          : "HTTP 403"

type TargetAttempt =
  | { readonly kind: "ok"; readonly patch: EmployerProfileDraft }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "blocked"; readonly block: EmployerHydrationBlock; readonly message: string }

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

      const rememberFailure = (target: EmployerHydrationTarget, message: string) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordFailure(tx, {
              kind: "employer",
              id: target.id,
              externalId: target.externalId
            }, message)
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`employer hydration attempt was not recorded for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const rememberSuccess = (target: EmployerHydrationTarget) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordSuccess(tx, {
              kind: "employer",
              id: target.id,
              externalId: target.externalId
            })
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`employer hydration attempt was not cleared for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const rememberMissing = (target: EmployerHydrationTarget) =>
        database
          .asOwner((tx) =>
            HydrationAttemptRepository.recordDeferred(tx, {
              kind: "employer",
              id: target.id,
              externalId: target.externalId
            }, EMPLOYER_RECHECK_SECONDS, "страница без новых полей профиля")
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`employer hydration deferral was not recorded for ${target.externalId}`, cause)
            ),
            Effect.asVoid
          )

      const attemptEmployer = (
        target: EmployerHydrationTarget,
        config: ProxyConfig | null
      ): Effect.Effect<TargetAttempt> =>
        Effect.gen(function*() {
          const pageUrl = `https://hh.ru/employer/${target.externalId}`

          const proxy = yield* Effect.try({
            try: () => proxyForUrl(config, pageUrl),
            catch: (error) =>
              new InvalidInput({
                message: error instanceof Error ? error.message : String(error)
              })
          })
          const fetchPage = yield* PageFetch
          const response = yield* Effect.tryPromise({
            try: () => fetchPage(pageUrl, proxy),
            catch: (error) => error
          })

          const block = classifyResponse(response.status, response.html)
          if (block !== null) {
            return {
              kind: "blocked" as const,
              block,
              message: `fetch ${pageUrl}: hh.ru ответил ${blockLabel(block)}; проход остановлен`
            }
          }
          if (response.status !== 200) {
            return { kind: "failed" as const, message: `fetch ${pageUrl}: HTTP ${response.status}` }
          }

          // A redirect to another company means the id is wrong or the page is
          // a search/error shell. Writing it would corrupt the profile.
          const redirected = employerIdFromUrl(response.url)
          if (redirected !== null && redirected !== target.externalId) {
            return {
              kind: "failed" as const,
              message:
                `fetch ${pageUrl}: hh.ru перенаправил на компанию ${redirected}, ` +
                `ожидалась ${target.externalId}`
            }
          }

          const patch = yield* extractEmployer(response.html, {
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

          // The profile page rarely carries the rating; hh serves it from a
          // separate reviews widget. Best effort: a widget failure keeps the profile.
          const widgetUrl = employerReviewsWidgetUrl(target.externalId)
          const widget = yield* Effect.tryPromise({
            try: () => fetchPage(widgetUrl, proxy),
            catch: (error) => error
          }).pipe(
            Effect.map((reply) =>
              reply.status === 200 ? parseEmployerReviewsWidget(reply.html) : null
            ),
            Effect.catchCause(() => Effect.succeed(null))
          )

          return {
            kind: "ok" as const,
            patch: widget === null
              ? patch
              : {
                ...patch,
                rating: widget.rating ?? patch.rating,
                reviewsCount: widget.reviewsCount ?? patch.reviewsCount,
                recommendationsPercent: widget.recommendationsPercent ?? patch.recommendationsPercent
              }
          }
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.succeed({
              kind: "failed" as const,
              message: `fetch ${pageUrlFor(target)}: ${
                error instanceof Error ? error.message : String(error)
              }`
            })
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

      const downloadEmployer = (
        target: EmployerHydrationTarget,
        config: ProxyConfig | null
      ): Effect.Effect<{ readonly outcome: TargetAttempt; readonly rotations: number }> =>
        Effect.gen(function*() {
          let outcome = yield* attemptEmployer(target, config)
          if (outcome.kind !== "blocked") return { outcome, rotations: 0 }
          if (!(yield* rotateOnce(config))) return { outcome, rotations: 0 }
          outcome = yield* attemptEmployer(target, config)
          return { outcome, rotations: 1 }
        })

      /** Saves one parsed profile; false when the write itself failed. */
      const saveProfile = (
        target: EmployerHydrationTarget,
        patch: EmployerProfileDraft,
        errors: string[]
      ) =>
        database
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
          .asOwner((tx) => EmployerRepository.listForRefresh(tx, { limit, onlyDue: true }))
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
        let rotations = 0
        let stoppedBy: EmployerHydrationBlock | null = null
        const errors: string[] = []

        const pushError = (message: string) => {
          if (errors.length < 5) errors.push(message)
        }

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
                stoppedBy,
                rotations,
                ...proxy
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("employer hydration progress could not be persisted", cause))
              )

        for (const [index, target] of targets.entries()) {
          processed += 1

          const download = yield* downloadEmployer(target, config)
          rotations += download.rotations
          const outcome = download.outcome

          if (outcome.kind === "blocked") {
            failed += 1
            pushError(outcome.message)
            stoppedBy = outcome.block
            yield* rememberFailure(target, outcome.message)
            yield* reportProgress(target.name)
            break
          }

          if (outcome.kind === "failed") {
            failed += 1
            pushError(outcome.message)
            yield* rememberFailure(target, outcome.message)
          } else if (yield* saveProfile(target, outcome.patch, errors)) {
            updated += 1
            if (stillMissingAfter(target, outcome.patch)) yield* rememberMissing(target)
            else yield* rememberSuccess(target)
          } else {
            failed += 1
            yield* rememberFailure(target, `update failed for ${target.externalId}`)
          }

          yield* reportProgress(target.name)

          if (delayMs > 0 && index < targets.length - 1) {
            yield* Effect.sleep(`${delayMs} millis`)
          }
        }

        if (processed > 0) {
          yield* Effect.logInfo(
            `employer hydration: ${updated}/${processed} updated, ${failed} failed` +
              (stoppedBy === null ? "" : `, stopped by ${stoppedBy}`)
          )
        }

        return { processed, target: targets.length, updated, failed, errors, stoppedBy, rotations, ...proxy }
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

        const { outcome } = yield* downloadEmployer(target, config)
        if (outcome.kind !== "ok") {
          yield* rememberFailure(target, outcome.message)
          yield* Effect.logWarning(`employer hydrate failed: ${outcome.message}`)
          return false
        }

        const errors: string[] = []
        if (!(yield* saveProfile(target, outcome.patch, errors))) {
          yield* rememberFailure(target, errors[0] ?? `update failed for ${target.externalId}`)
          return false
        }

        if (stillMissingAfter(target, outcome.patch)) yield* rememberMissing(target)
        else yield* rememberSuccess(target)
        yield* Effect.logInfo(`employer hydrated: ${target.externalId}`)
        return true
      })

      return EmployerHydrator.of({ run, hydrateOne })
    })
  )
}

const pageUrlFor = (target: EmployerHydrationTarget): string =>
  `https://hh.ru/employer/${target.externalId}`
