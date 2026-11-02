import type { ApiError, CrawlFinishStatus, CrawlRun, VacancyId } from "@otbor/contract"
import { normalizeSearchUrl, NotFound, searchTextFromUrl } from "@otbor/contract"
import { Effect, Context, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as SearchRepository from "../repositories/SearchRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface CrawlStartInput {
  readonly url: string
  readonly startPage?: number
  readonly title?: string
}

export interface CrawlSavePageInput {
  readonly runId: string
  readonly nextPage: number
  readonly pagesDone: number
  readonly found: number
  readonly vacancyIds: ReadonlyArray<VacancyId>
}

export interface CrawlFinishInput {
  readonly runId: string
  readonly status: CrawlFinishStatus
  readonly nextPage: number
  readonly pagesDone: number
  readonly found: number
  readonly error?: string | null
}

export interface CrawlServiceShape {
  readonly start: (input: CrawlStartInput) => Effect.Effect<CrawlRun, ApiError>
  readonly savePage: (input: CrawlSavePageInput) => Effect.Effect<CrawlRun, ApiError>
  readonly finish: (input: CrawlFinishInput) => Effect.Effect<CrawlRun, ApiError>
  readonly status: (runId: string) => Effect.Effect<CrawlRun, ApiError>
}

/**
 * Search-run bookkeeping. The crawler owns the loop and the parser; this
 * service owns the durable identity of the search (`search_query`), the run
 * cursor and the links between a query and the vacancies it found.
 */
export class CrawlService extends Context.Service<CrawlService, CrawlServiceShape>()(
  "otbor/cloud/CrawlService"
) {
  static readonly layer = Layer.effect(
    CrawlService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const start = Effect.fn("CrawlService.start")(function*(input: CrawlStartInput) {
        const normalizedUrl = normalizeSearchUrl(input.url)
        const textQuery = searchTextFromUrl(input.url)
        const title = input.title ?? textQuery

        return yield* database
          .asOwner((tx) =>
            Effect.gen(function*() {
              const [query] = yield* SearchRepository.upsertQuery(tx, {
                url: input.url,
                normalizedUrl,
                title,
                textQuery
              })
              const [run] = yield* SearchRepository.createRun(
                tx,
                query!.id,
                input.startPage ?? 0
              )
              const row = yield* SearchRepository.findRun(tx, run!.id)
              return SearchRepository.toCrawlRun(row!)
            })
          )
          .pipe(Effect.mapError(toStorageError("crawl.start")))
      })

      const savePage = Effect.fn("CrawlService.savePage")(function*(
        input: CrawlSavePageInput
      ) {
        const row = yield* database
          .asOwner((tx) =>
            Effect.gen(function*() {
              const existing = yield* SearchRepository.findRun(tx, input.runId)
              if (existing === null) return null

              yield* SearchRepository.updateRunProgress(tx, input.runId, {
                pagesDone: input.pagesDone,
                found: input.found,
                nextPage: input.nextPage
              })

              const hits = SearchRepository.searchHitRows(existing.queryId, input.vacancyIds)
              yield* SearchRepository.insertHits(tx, hits)

              return yield* SearchRepository.findRun(tx, input.runId)
            })
          )
          .pipe(Effect.mapError(toStorageError("crawl.savePage")))

        if (row === null) {
          return yield* new NotFound({ entity: "SearchRun", id: input.runId })
        }
        return SearchRepository.toCrawlRun(row)
      })

      const finish = Effect.fn("CrawlService.finish")(function*(input: CrawlFinishInput) {
        const row = yield* database
          .asOwner((tx) =>
            Effect.gen(function*() {
              const existing = yield* SearchRepository.findRun(tx, input.runId)
              if (existing === null) return null

              yield* SearchRepository.finishRun(tx, input.runId, {
                status: input.status,
                pagesDone: input.pagesDone,
                found: input.found,
                nextPage: input.nextPage,
                error: input.error
              })

              return yield* SearchRepository.findRun(tx, input.runId)
            })
          )
          .pipe(Effect.mapError(toStorageError("crawl.finish")))

        if (row === null) {
          return yield* new NotFound({ entity: "SearchRun", id: input.runId })
        }
        return SearchRepository.toCrawlRun(row)
      })

      const status = Effect.fn("CrawlService.status")(function*(runId: string) {
        const row = yield* database
          .asUser(currentUser.userId, (tx) => SearchRepository.findRun(tx, runId))
          .pipe(Effect.mapError(toStorageError("crawl.status")))

        if (row === null) {
          return yield* new NotFound({ entity: "SearchRun", id: runId })
        }
        return SearchRepository.toCrawlRun(row)
      })

      return CrawlService.of({ start, savePage, finish, status })
    })
  )
}
