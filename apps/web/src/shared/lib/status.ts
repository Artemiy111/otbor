export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral"

const SUCCESS = new Set([
  "ok",
  "up",
  "match",
  "apply",
  "submitted",
  "done",
  "prepared",
  "clicked",
  "active"
])

const INFO = new Set([
  "unknown",
  "draft",
  "queued",
  "pending",
  "leased",
  "running",
  "prepare",
  "submit",
  "reconcile",
  "session",
  "inference"
])

const WARNING = new Set([
  "degraded",
  "submitting",
  "form_changed",
  "rate_limited",
  "already_responded",
  "not_submitted",
  "cancelled"
])

const DANGER = new Set([
  "reject",
  "skip",
  "failed",
  "dead",
  "needs_human",
  "needs_reconcile",
  "down",
  "blocked",
  "session_expired",
  "captcha",
  "ambiguous",
  "permanent",
  "site_rejected",
  "answer_rejected",
  "inference_failed",
  "transport",
  "resume_mismatch"
])

/** One presentation map for every status token the contract can return. */
export const statusTone = (value: string): StatusTone => {
  if (SUCCESS.has(value)) return "success"
  if (INFO.has(value)) return "info"
  if (WARNING.has(value)) return "warning"
  if (DANGER.has(value)) return "danger"
  return "neutral"
}

export const statusLabel = (value: string): string => value.replaceAll("_", " ")
