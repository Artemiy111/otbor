import { fetchHtml } from "@otbor/crawler"
import { Context } from "effect"

/** One downloaded hh page. `url` is the final URL after redirects. */
export interface PageResponse {
  readonly status: number
  readonly url: string
  readonly html: string
}

/**
 * The only way hydration downloads a page. A test replaces this reference so
 * the suite never touches hh.ru; production uses the shared crawler client.
 */
export const PageFetch = Context.Reference<
  (url: string, proxy: string | null) => Promise<PageResponse>
>("otbor/cloud/PageFetch", {
  defaultValue: () => (url, proxy) => fetchHtml(url, { proxy })
})
