import type { AutoApplyStage } from "@otbor/contract"
import { BLOCKED_REASON_LABELS } from "@otbor/contract"
import { AUTO_STAGE_STATUS } from "./status"

export const autoApplyKeys = {
  all: ["auto-apply"] as const,
  preview: (hhAccountId: string, resumeId: string | null) =>
    ["auto-apply", "preview", hhAccountId, resumeId ?? "account"] as const,
  progress: (hhAccountId: string, activeOnly: boolean) =>
    ["auto-apply", "progress", hhAccountId, activeOnly ? "active" : "all"] as const
}

export type AutoApplyStageTone = "neutral" | "info" | "warning" | "success" | "danger"

/** Stages in pipeline order. Слова и тон берутся из единого словаря `status.ts`. */
export const autoApplyStages: ReadonlyArray<{
  value: AutoApplyStage
  label: string
  tone: AutoApplyStageTone
  /** Still moving: the progress tab keeps refreshing while any exists. */
  active: boolean
}> = (
  [
    ["waiting", true],
    ["blocked", false],
    ["reading_form", true],
    ["writing", true],
    ["kit_ready", true],
    ["submitting", true],
    ["submitted", false],
    ["needs_human", false],
    ["failed", false]
  ] as const
).map(([value, active]) => ({ value, active, ...AUTO_STAGE_STATUS[value] }))

export const autoApplyStageMeta = (stage: AutoApplyStage) =>
  autoApplyStages.find((item) => item.value === stage) ?? autoApplyStages[0]!

/** Смысл кода остановки по-русски; незнакомый код показывается как есть. */
export const blockedReasonLabel = (code: string | null | undefined): string | null =>
  code === null || code === undefined
    ? null
    : (BLOCKED_REASON_LABELS as Readonly<Record<string, string>>)[code] ?? code

export const autoRunLabel = (autoRun: "drafts" | "auto"): string =>
  autoRun === "auto" ? "авто" : "авто-черновик"

/** Режим автооткликов: off нейтральный, drafts информационный, auto успешный (не красный). */
export const autoModeTone = (mode: "off" | "drafts" | "auto"): "neutral" | "info" | "success" =>
  mode === "auto" ? "success" : mode === "drafts" ? "info" : "neutral"
