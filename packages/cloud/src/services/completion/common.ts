import type { HarnessExit } from "@otbor/contract"

/** `tag` or `tag: message` (the harness reason, trimmed to 500 chars) so a person can see WHY. */
export const exitDetail = (exit: HarnessExit): string => {
  const text = (exit.message ?? "").replace(/\s+/g, " ").trim()
  if (text === "") return exit.tag
  return `${exit.tag}: ${text.length > 500 ? `${text.slice(0, 497)}...` : text}`
}

/** Retry the same row; the lease and epoch make a duplicate harmless. */
export const retryLater = (exit: HarnessExit, fallbackSeconds: number) =>
  new Date(Date.now() + Math.max(exit.retryAfterSeconds ?? fallbackSeconds, 1) * 1_000)
