import type { Component } from "vue"
import {
  Ban,
  BookOpen,
  Briefcase,
  Building,
  CalendarClock,
  ChartColumn,
  DatabaseZap,
  FileText,
  Filter,
  Gavel,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageCircle,
  MessagesSquare,
  Rocket,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  User,
  Users
} from "@lucide/vue"

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly icon: Component
}

export interface NavSection {
  readonly id: string
  /** `null` - группа без заголовка (только «Обзор»). */
  readonly label: string | null
  /** Сворачиваемая группа; состояние хранится в браузере. */
  readonly collapsible?: boolean
  /** Свёрнута, пока оператор её не открыл. */
  readonly collapsedByDefault?: boolean
  readonly items: ReadonlyArray<NavItem>
}

/**
 * Навигация по задачам оператора, а не по сущностям бэкенда. Пункт остаётся
 * активным на своих страницах деталей (см. `activeSection` в роутере).
 */
export const navSections: ReadonlyArray<NavSection> = [
  {
    id: "overview",
    label: null,
    items: [{ id: "overview", label: "Обзор", href: "/", icon: LayoutDashboard }]
  },
  {
    id: "work",
    label: "Работа",
    items: [
      { id: "vacancies", label: "Вакансии", href: "/vacancies", icon: Briefcase },
      { id: "applications", label: "Отклики", href: "/applications", icon: Send },
      { id: "auto-apply", label: "Автоотклики", href: "/auto-apply", icon: Rocket },
      { id: "contacts", label: "Переписка", href: "/contacts", icon: MessagesSquare },
      { id: "people", label: "Люди", href: "/people", icon: Users }
    ]
  },
  {
    id: "selection",
    label: "Настройка отбора",
    items: [
      { id: "resumes", label: "Резюме", href: "/resumes", icon: FileText },
      { id: "apply-filter", label: "Фильтр откликов", href: "/apply-filter", icon: Filter },
      { id: "presets", label: "Пресеты", href: "/presets", icon: SlidersHorizontal },
      { id: "blacklist", label: "Чёрный список", href: "/blacklist", icon: Ban },
      { id: "keywords", label: "Ключевые слова", href: "/keywords", icon: BookOpen }
    ]
  },
  {
    id: "sources",
    label: "Источники",
    items: [
      { id: "search", label: "Поиск вакансий", href: "/search", icon: Search },
      { id: "schedules", label: "Расписания", href: "/schedules", icon: CalendarClock },
      { id: "mail", label: "Почта", href: "/mail", icon: Mail },
      { id: "telegram", label: "Telegram", href: "/telegram", icon: MessageCircle },
      { id: "accounts", label: "Аккаунты hh", href: "/accounts", icon: User }
    ]
  },
  {
    id: "system",
    label: "Система",
    collapsible: true,
    collapsedByDefault: true,
    items: [
      { id: "health", label: "Состояние", href: "/health", icon: HeartPulse },
      { id: "queue", label: "Очереди", href: "/queue", icon: ListChecks },
      { id: "hydration", label: "Догрузка данных", href: "/hydration", icon: DatabaseZap },
      { id: "analytics", label: "Аналитика рынка", href: "/analytics", icon: ChartColumn },
      { id: "companies", label: "Компании", href: "/companies", icon: Building },
      { id: "decisions", label: "Решения", href: "/decisions", icon: Gavel },
      { id: "inference", label: "Генерация", href: "/inference", icon: Sparkles },
      { id: "settings", label: "Настройки", href: "/settings", icon: Settings }
    ]
  }
]

export const navItems: ReadonlyArray<NavItem> = navSections.flatMap((section) => section.items)

export const navLabel = (section: string): string =>
  navItems.find((item) => item.id === section)?.label ?? ""
