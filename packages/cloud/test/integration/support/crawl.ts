import type { CrawlFinishStatus, VacancyId } from "@otbor/contract"
import { Effect } from "effect"
import { type CrawlSavePageInput, CrawlService } from "../../../src/services/CrawlService.ts"
import { runAs, runAsFailure } from "./layers.ts"

export const crawlStart = async (
  userId: string,
  input: { readonly url: string; readonly startPage?: number; readonly title?: string }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.start(input)
    })
  )

/** `vacancyIds` is typed loosely on purpose: the seeds hand back plain UUIDs. */
export type CrawlSavePageTestInput = Omit<CrawlSavePageInput, "vacancyIds"> & {
  readonly vacancyIds: ReadonlyArray<string>
}

const crawlSavePageEffect = (input: CrawlSavePageTestInput) =>
  Effect.gen(function*() {
    const crawl = yield* CrawlService
    return yield* crawl.savePage({
      ...input,
      vacancyIds: input.vacancyIds as ReadonlyArray<VacancyId>
    })
  })

export const crawlSavePage = (userId: string, input: CrawlSavePageTestInput) =>
  runAs(userId, crawlSavePageEffect(input))

export const crawlSavePageFailure = (userId: string, input: CrawlSavePageTestInput) =>
  runAsFailure(userId, crawlSavePageEffect(input))

export const crawlFinish = async (
  userId: string,
  input: {
    readonly runId: string
    readonly status: CrawlFinishStatus
    readonly nextPage: number
    readonly pagesDone: number
    readonly found: number
    readonly error?: string | null
    readonly inserted?: number
    readonly updated?: number
    readonly skipped?: number
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.finish(input)
    })
  )

export const crawlRunsList = async (
  userId: string,
  input: {
    readonly queryId?: string
    readonly url?: string
    readonly limit?: number
    readonly offset?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.listRuns(input)
    })
  )

export const crawlStatus = async (userId: string, runId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      return yield* crawl.status(runId)
    })
  )
