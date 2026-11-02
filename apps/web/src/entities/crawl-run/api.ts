import type { CrawlRun, SearchQueryId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface CrawlRunListInput {
  readonly queryId?: string
  readonly url?: string
  readonly limit?: number
  readonly offset?: number
}

export interface CrawlRunListResult {
  readonly items: ReadonlyArray<CrawlRun>
  readonly total: number
}

export const crawlRunApi = {
  list: (input: CrawlRunListInput): Promise<CrawlRunListResult> =>
    call((client) =>
      client.CrawlRunsList({
        queryId: input.queryId as SearchQueryId | undefined,
        url: input.url,
        limit: input.limit,
        offset: input.offset
      })
    )
}
