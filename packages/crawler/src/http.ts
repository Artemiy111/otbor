/**
 * HTTP transport for hh.ru pages. Bun's `fetch` accepts a `proxy` option for
 * an HTTP/mixed listener; SOCKS is intentionally rejected in proxy config.
 */

export interface FetchHtmlOptions {
  readonly proxy?: string | null
  readonly timeoutMs?: number
  readonly headers?: Record<string, string>
}

export interface HtmlResponse {
  readonly status: number
  readonly url: string
  readonly html: string
}

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache"
}

export const fetchHtml = async (
  url: string,
  options: FetchHtmlOptions = {}
): Promise<HtmlResponse> => {
  const init: RequestInit & { proxy?: string } = {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
  }
  if (options.proxy !== null && options.proxy !== undefined) {
    init.proxy = options.proxy
  }

  const response = await fetch(url, init)
  return {
    status: response.status,
    url: response.url || url,
    html: await response.text()
  }
}
