import type { Component } from "vue"
import {
  Briefcase,
  Gavel,
  HeartPulse,
  ListChecks,
  Send,
  Sparkles
} from "lucide-vue-next"

export interface NavItem {
  readonly label: string
  readonly href: string
  readonly section: string
  readonly icon: Component
}

export const navItems: ReadonlyArray<NavItem> = [
  { label: "Health", href: "#/health", section: "health", icon: HeartPulse },
  { label: "Vacancies", href: "#/vacancies", section: "vacancies", icon: Briefcase },
  { label: "Decisions", href: "#/decisions", section: "decisions", icon: Gavel },
  { label: "Applications", href: "#/applications", section: "applications", icon: Send },
  { label: "Queue", href: "#/queue", section: "queue", icon: ListChecks },
  { label: "Inference", href: "#/inference", section: "inference", icon: Sparkles }
]
