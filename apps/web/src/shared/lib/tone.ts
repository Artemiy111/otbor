import type { StatusTone } from "./status"

/**
 * Готовые классы Tailwind для одного тона. Строки написаны целиком, чтобы
 * Tailwind видел их при сканировании исходников. Единый источник цвета для
 * бейджей, точек статуса, карточек и обзора.
 */
export interface ToneClasses {
  /** Цвет текста и иконок. */
  readonly text: string
  /** Мягкая подложка. */
  readonly bg: string
  /** Полупрозрачная рамка. */
  readonly border: string
  /** Сплошная точка-индикатор. */
  readonly dot: string
  /** Готовая комбинация для бейджа: рамка + подложка + текст. */
  readonly badge: string
}

const TONES: Record<StatusTone, ToneClasses> = {
  success: {
    text: "text-success",
    bg: "bg-success-muted",
    border: "border-success/30",
    dot: "bg-success",
    badge: "border-success/30 bg-success-muted text-success"
  },
  info: {
    text: "text-info",
    bg: "bg-info-muted",
    border: "border-info/30",
    dot: "bg-info",
    badge: "border-info/30 bg-info-muted text-info"
  },
  warning: {
    text: "text-warning",
    bg: "bg-warning-muted",
    border: "border-warning/30",
    dot: "bg-warning",
    badge: "border-warning/30 bg-warning-muted text-warning"
  },
  danger: {
    text: "text-danger",
    bg: "bg-danger-muted",
    border: "border-danger/30",
    dot: "bg-danger",
    badge: "border-danger/30 bg-danger-muted text-danger"
  },
  neutral: {
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    dot: "bg-muted-foreground/50",
    badge: "border-border bg-muted text-muted-foreground"
  }
}

export const toneClasses = (tone: StatusTone): ToneClasses => TONES[tone]
