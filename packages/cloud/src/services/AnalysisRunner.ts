import type { ApiError } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_THRESHOLD,
  buildAnalysisState,
  interpretAnswers
} from "@otbor/domain"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as VacancyAnalysisRepository from "../repositories/VacancyAnalysisRepository.ts"
import { isServerDown, SystemOneClient } from "./SystemOneClient.ts"
import { stableHash } from "./support.ts"

export type AnalysisStop = "unreachable" | "unauthorized"

/** Safe, JSON-shaped progress snapshot written to `schedule_run.detail`. */
export interface AnalysisProgress {
  readonly processed: number
  readonly analysed: number
  readonly skipped: number
  readonly failed: number
  readonly target: number
  readonly errors: ReadonlyArray<string>
  readonly stoppedBy: AnalysisStop | null
}

export interface AnalysisRunOptions {
  /** Upper bound on model calls (analysed + failed). Skips of fresh rows are free. */
  readonly limit: number
  readonly delayMs?: number
  readonly onProgress?: (progress: AnalysisProgress) => Effect.Effect<void>
}

export interface AnalysisRunResult {
  readonly processed: number
  readonly analysed: number
  readonly skipped: number
  readonly failed: number
  readonly errors: ReadonlyArray<string>
  readonly stoppedBy: AnalysisStop | null
}

export interface AnalysisRunnerShape {
  readonly run: (options: AnalysisRunOptions) => Effect.Effect<AnalysisRunResult, ApiError>
}

const PAGE = 25

/** The hash of exactly what the model would see; a changed prompt version changes it too. */
export const analysisInputHash = (state: unknown): string =>
  stableHash({ state, promptVersion: ANALYSIS_PROMPT_VERSION })

const storage = (operation: string) => (cause: unknown) =>
  new InvalidInput({
    message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`
  })

/**
 * `analysis` schedule: one bounded, sequential pass over fully hydrated
 * vacancies whose analysis is missing or stale. A candidate whose input hash
 * is unchanged is marked fresh instead of being sent to the model again. If
 * the model server is down or rejects the key, the pass stops with one clear
 * error instead of failing every remaining vacancy.
 */
export class AnalysisRunner extends Context.Service<AnalysisRunner, AnalysisRunnerShape>()(
  "otbor/cloud/AnalysisRunner"
) {
  static readonly layer = Layer.effect(
    AnalysisRunner,
    Effect.gen(function*() {
      const database = yield* Database
      const client = yield* SystemOneClient

      const run = Effect.fn("AnalysisRunner.run")(function*(options: AnalysisRunOptions) {
        if (!client.enabled) {
          // Анализ выключен через OTBOR_SYSTEMONE_ENABLED=false: модель не трогаем.
          yield* Effect.logDebug("analysis: отключён (OTBOR_SYSTEMONE_ENABLED=false), проход пропущен")
          return { processed: 0, analysed: 0, skipped: 0, failed: 0, errors: [], stoppedBy: null }
        }
        const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 500)
        const delayMs = Math.max(0, options.delayMs ?? 0)

        let processed = 0
        let analysed = 0
        let skipped = 0
        let failed = 0
        let stoppedBy: AnalysisStop | null = null
        const errors: string[] = []
        const pushError = (message: string) => {
          if (errors.length < 5) errors.push(message)
        }

        const report = () =>
          options.onProgress === undefined
            ? Effect.void
            : options.onProgress({
                processed,
                analysed,
                skipped,
                failed,
                target: limit,
                errors: [...errors],
                stoppedBy
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("analysis progress could not be persisted", cause))
              )

        const fail = (vacancyId: string, message: string) => {
          failed += 1
          pushError(`${vacancyId}: ${message}`)
          return Effect.logWarning(`analysis ${vacancyId}: ${message}`)
        }

        scan: while (analysed + failed < limit && stoppedBy === null) {
          // Failed rows stay candidates; analysed and freshened rows drop out.
          const page = yield* database
            .asOwner((tx) =>
              VacancyAnalysisRepository.listCandidates(tx, {
                promptVersion: ANALYSIS_PROMPT_VERSION,
                limit: PAGE,
                offset: failed
              })
            )
            .pipe(Effect.mapError(storage("analysis candidates")))
          if (page.length === 0) break

          for (const candidate of page) {
            if (analysed + failed >= limit) break scan
            processed += 1

            const state = buildAnalysisState(candidate.input)
            const inputHash = analysisInputHash(state)

            if (candidate.current !== null && candidate.current.inputHash === inputHash) {
              const marked = yield* database
                .asOwner((tx) =>
                  VacancyAnalysisRepository.markFresh(tx, candidate.vacancyId, ANALYSIS_PROMPT_VERSION)
                )
                .pipe(Effect.result)
              if (marked._tag === "Failure") {
                yield* fail(candidate.vacancyId, "could not mark the analysis fresh")
              } else {
                skipped += 1
              }
              yield* report()
              continue
            }

            const outcome = yield* client.analyze(state).pipe(Effect.result)
            if (outcome._tag === "Failure") {
              const error = outcome.failure
              if (isServerDown(error)) {
                // The server is the problem, not this vacancy: stop the pass.
                processed -= 1
                stoppedBy = error.kind === "unauthorized" ? "unauthorized" : "unreachable"
                pushError(error.message)
                yield* Effect.logWarning(`analysis pass stopped: ${error.message}`)
                yield* report()
                break scan
              }
              yield* fail(candidate.vacancyId, error.message)
              yield* report()
              continue
            }

            const { answers, latencyMs } = outcome.success
            const facts = interpretAnswers(answers, {
              threshold: ANALYSIS_THRESHOLD,
              employerCategory: candidate.employerCategory
            })
            const saved = yield* database
              .asOwner((tx) =>
                VacancyAnalysisRepository.upsert(tx, {
                  vacancyId: candidate.vacancyId,
                  promptVersion: ANALYSIS_PROMPT_VERSION,
                  inputHash,
                  model: client.model,
                  answers,
                  facts,
                  threshold: ANALYSIS_THRESHOLD,
                  latencyMs: Math.round(latencyMs)
                })
              )
              .pipe(Effect.result)
            if (saved._tag === "Failure") {
              yield* fail(candidate.vacancyId, "could not store the analysis")
            } else {
              analysed += 1
            }
            yield* report()

            if (delayMs > 0) yield* Effect.sleep(`${delayMs} millis`)
          }
        }

        if (processed > 0 || stoppedBy !== null) {
          yield* Effect.logInfo(
            `analysis: ${analysed} analysed, ${skipped} fresh, ${failed} failed` +
              (stoppedBy === null ? "" : `, stopped by ${stoppedBy}`)
          )
        }
        return { processed, analysed, skipped, failed, errors, stoppedBy }
      })

      return AnalysisRunner.of({ run })
    })
  )
}
