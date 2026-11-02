import type { Component } from "vue"
import {
  BookOpen,
  Briefcase,
  Building,
  CalendarClock,
  Gavel,
  HeartPulse,
  ListChecks,
  Send,
  SlidersHorizontal,
  Sparkles
} from "@lucide/vue"

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly icon: Component
}

export interface NavSection {
  readonly id: string
  readonly label: string
  readonly items: ReadonlyArray<NavItem>
}

/** Grouped navigation: the sidebar item stays active on its detail pages. */
export const navSections: ReadonlyArray<NavSection> = [
  {
    id: "overview",
    label: "Обзор",
    items: [{ id: "health", label: "Здоровье", href: "#/health", icon: HeartPulse }]
  },
  {
    id: "corpus",
    label: "Корпус",
    items: [
      { id: "vacancies", label: "Вакансии", href: "#/vacancies", icon: Briefcase },
      { id: "companies", label: "Компании", href: "#/companies", icon: Building },
      { id: "keywords", label: "Ключевые слова", href: "#/keywords", icon: BookOpen }
    ]
  },
  {
    id: "selection",
    label: "Отбор",
    items: [
      { id: "decisions", label: "Решения", href: "#/decisions", icon: Gavel },
      { id: "applications", label: "Отклики", href: "#/applications", icon: Send }
    ]
  },
  {
    id: "automation",
    label: "Автоматизация",
    items: [
      { id: "queue", label: "Очередь", href: "#/queue", icon: ListChecks },
      { id: "inference", label: "Генерация", href: "#/inference", icon: Sparkles },
      { id: "presets", label: "Пресеты", href: "#/presets", icon: SlidersHorizontal },
      { id: "schedules", label: "Обход", href: "#/schedules", icon: CalendarClock }
    ]
  }
]

export const navItems: ReadonlyArray<NavItem> = navSections.flatMap((section) => section.items)

export const navLabel = (section: string): string =>
  navItems.find((item) => item.id === section)?.label ?? ""
