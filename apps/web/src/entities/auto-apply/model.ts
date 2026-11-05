import type { AutoApplyStage } from "@otbor/contract"

export const autoApplyKeys = {
  all: ["auto-apply"] as const,
  preview: (hhAccountId: string, resumeId: string | null) =>
    ["auto-apply", "preview", hhAccountId, resumeId ?? "account"] as const,
  progress: (hhAccountId: string, activeOnly: boolean) =>
    ["auto-apply", "progress", hhAccountId, activeOnly ? "active" : "all"] as const
}

export type AutoApplyStageTone = "neutral" | "info" | "warning" | "success" | "destructive"

/** Stages in pipeline order, with the badge label and tone. */
export const autoApplyStages: ReadonlyArray<{
  value: AutoApplyStage
  label: string
  tone: AutoApplyStageTone
  /** Still moving: the progress tab keeps refreshing while any exists. */
  active: boolean
}> = [
  { value: "waiting", label: "Ждёт", tone: "neutral", active: true },
  { value: "reading_form", label: "Читается форма", tone: "info", active: true },
  { value: "writing", label: "Пишется письмо", tone: "info", active: true },
  { value: "kit_ready", label: "Кит готов", tone: "warning", active: true },
  { value: "submitting", label: "Отправка", tone: "warning", active: true },
  { value: "submitted", label: "Отправлен", tone: "success", active: false },
  { value: "needs_human", label: "Нужен человек", tone: "warning", active: false },
  { value: "failed", label: "Ошибка", tone: "destructive", active: false }
]

export const autoApplyStageMeta = (stage: AutoApplyStage) =>
  autoApplyStages.find((item) => item.value === stage) ?? autoApplyStages[0]!

export const autoRunLabel = (autoRun: "drafts" | "auto"): string =>
  autoRun === "auto" ? "авто" : "авто-черновик"
