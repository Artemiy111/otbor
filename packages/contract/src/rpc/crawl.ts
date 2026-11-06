import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { CrawlFinishStatus } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { SearchQueryId, SearchRunId, VacancyId } from "../ids.ts"
import { CrawlRun } from "../models/index.ts"

/**
 * The crawler owns fetching and parsing; the cloud owns the run record and the
 * query/vacancy links. These four calls are the whole persistence surface, and
 * the corpus itself still goes through `VacanciesUpsert`.
 */
export const CrawlStart = Rpc.make("CrawlStart", {
  payload: Schema.Struct({
    url: Schema.String,
    startPage: Schema.optional(Schema.Int),
    title: Schema.optional(Schema.String)
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlSavePage = Rpc.make("CrawlSavePage", {
  payload: Schema.Struct({
    runId: SearchRunId,
    nextPage: Schema.Int,
    pagesDone: Schema.Int,
    found: Schema.Int,
    /** Ingested vacancies from this page, in card order. */
    vacancyIds: Schema.Array(VacancyId),
    currentPage: Schema.optional(Schema.NullOr(Schema.Int)),
    pagesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
    inserted: Schema.optional(Schema.Int),
    updated: Schema.optional(Schema.Int),
    skipped: Schema.optional(Schema.Int)
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlFinish = Rpc.make("CrawlFinish", {
  payload: Schema.Struct({
    runId: SearchRunId,
    status: CrawlFinishStatus,
    nextPage: Schema.Int,
    pagesDone: Schema.Int,
    found: Schema.Int,
    inserted: Schema.optional(Schema.Int),
    updated: Schema.optional(Schema.Int),
    skipped: Schema.optional(Schema.Int),
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlStatus = Rpc.make("CrawlStatus", {
  payload: Schema.Struct({ runId: SearchRunId }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlRunsList = Rpc.make("CrawlRunsList", {
  payload: Schema.Struct({
    queryId: Schema.optional(SearchQueryId),
    url: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(CrawlRun),
    total: Schema.Int
  }),
  error: ApiError
})
