import { Schema } from "effect"

/**
 * Crawler failures are typed so the CLI can distinguish a blocked IP from a
 * parser change or a transport error. The cloud never sees these errors: the
 * crawler either emits drafts or reports why it stopped.
 */
export class CrawlerError extends Schema.TaggedError<CrawlerError>()("CrawlerError", {
  code: Schema.Literals([
    "search_state_missing",
    "search_state_invalid",
    "search_blocked_captcha",
    "search_blocked_auth",
    "search_blocked_forbidden",
    "search_blocked_geo",
    "vacancy_denied",
    "vacancy_not_found",
    "network",
    "proxy"
  ]),
  message: Schema.String
}) {}
