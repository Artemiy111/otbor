import type { VacancySort, VacancySortKey } from "@otbor/contract"
import type { StatusTone } from "@/shared/lib"

/**
 * Фильтры списка вакансий и их запись в адресе. Чистый модуль: им пользуются
 * страница, тесты и ссылки с обзора. Всё, что отличается от умолчания, лежит
 * в `?query`, поэтому вид списка можно переслать ссылкой, а переход по ссылке
 * на ту же страницу меняет список без перезагрузки.
 */

/** Быстрые фильтры над списком; `all` - без ограничения. */
export type QuickView = "all" | "new" | "apply" | "open" | "applied"

export type AnalysedFilter = "all" | "yes" | "no"

export interface VacancyFilters {
  /** Подстрока названия, компании или города. */
  readonly q: string
  readonly view: QuickView
  readonly sort: VacancySortKey
  /** Id аккаунта или `all`; `null` - основной аккаунт. */
  readonly account: string | null
  readonly archived: boolean
  readonly blacklisted: boolean
  readonly analysed: AnalysedFilter
  /** Номер страницы с нуля. */
  readonly page: number
}

export const DEFAULT_FILTERS: VacancyFilters = {
  q: "",
  view: "all",
  sort: "date",
  account: null,
  archived: false,
  blacklisted: false,
  analysed: "all",
  page: 0
}

export interface SortOption {
  readonly value: VacancySortKey
  readonly label: string
  readonly direction: VacancySort["direction"]
}

/** Осмысленные способы сортировки; направление у каждого своё и не выбирается. */
export const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: "priority", label: "По приоритету", direction: "desc" },
  { value: "fit", label: "По соответствию", direction: "desc" },
  { value: "date", label: "Сначала свежие", direction: "desc" },
  { value: "firstSeen", label: "Недавно найденные", direction: "desc" },
  { value: "salary", label: "По зарплате", direction: "desc" },
  { value: "employer", label: "По компании", direction: "asc" },
  { value: "title", label: "По названию", direction: "asc" }
]

export const sortOption = (key: VacancySortKey): SortOption =>
  SORT_OPTIONS.find((option) => option.value === key) ?? SORT_OPTIONS[2]!

export const QUICK_VIEWS: ReadonlyArray<{ readonly value: QuickView; readonly label: string }> = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "apply", label: "Подходят" },
  { value: "open", label: "Без отклика" },
  { value: "applied", label: "С откликом" }
]

const isView = (value: string | null): value is QuickView =>
  value !== null && QUICK_VIEWS.some((item) => item.value === value)

const isSort = (value: string | null): value is VacancySortKey =>
  value !== null && SORT_OPTIONS.some((item) => item.value === value)

const isAnalysed = (value: string | null): value is "yes" | "no" => value === "yes" || value === "no"

/** Читает фильтры из строки запроса адреса; неизвестные и битые значения дают умолчание. */
export const parseFilters = (search: string): VacancyFilters => {
  const params = new URLSearchParams(search)
  const view = params.get("view")
  const sort = params.get("sort")
  const analysed = params.get("analysed")
  const account = params.get("account")
  const page = Number.parseInt(params.get("page") ?? "", 10)
  return {
    q: (params.get("q") ?? "").trim(),
    view: isView(view) ? view : DEFAULT_FILTERS.view,
    sort: isSort(sort) ? sort : DEFAULT_FILTERS.sort,
    account: account === null || account === "" ? null : account,
    archived: params.get("archived") === "1",
    blacklisted: params.get("blacklisted") === "1",
    analysed: isAnalysed(analysed) ? analysed : "all",
    // В адресе страницы считаются с единицы.
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0
  }
}

/** Строка запроса для адреса; умолчания опущены, поэтому у чистого списка адрес без `?`. */
export const filtersToSearch = (filters: VacancyFilters): string => {
  const params = new URLSearchParams()
  if (filters.q !== "") params.set("q", filters.q)
  if (filters.view !== DEFAULT_FILTERS.view) params.set("view", filters.view)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort)
  if (filters.account !== null) params.set("account", filters.account)
  if (filters.archived) params.set("archived", "1")
  if (filters.blacklisted) params.set("blacklisted", "1")
  if (filters.analysed !== "all") params.set("analysed", filters.analysed)
  if (filters.page > 0) params.set("page", String(filters.page + 1))
  return params.toString()
}

/** Что быстрый фильтр добавляет к запросу списка. */
export interface QuickQuery {
  readonly verdict?: "apply"
  readonly applied?: "yes" | "no"
  readonly seenSince?: string
}

export const quickViewQuery = (view: QuickView, since: string): QuickQuery => {
  switch (view) {
    case "new":
      return { seenSince: since }
    case "apply":
      return { verdict: "apply" }
    case "open":
      return { applied: "no" }
    case "applied":
      return { applied: "yes" }
    default:
      return {}
  }
}

/* ---- «Новая»: что появилось с прошлого визита ---------------------------------- */

const DAY_MS = 24 * 3_600_000

/**
 * Граница «нового»: время прошлого визита из хранилища. Пустое или битое
 * значение (первый визит, очищенное хранилище) даёт последние сутки, чтобы
 * маркер не исчезал совсем и не заливал весь корпус.
 */
export const resolveSince = (stored: string | null | undefined, now: Date = new Date()): string => {
  const parsed = stored === null || stored === undefined || stored === "" ? Number.NaN : Date.parse(stored)
  return Number.isNaN(parsed) || parsed > now.getTime()
    ? new Date(now.getTime() - DAY_MS).toISOString()
    : new Date(parsed).toISOString()
}

/** Вакансия впервые найдена не раньше границы. */
export const isNewVacancy = (createdAt: string, since: string): boolean => {
  const created = Date.parse(createdAt)
  const edge = Date.parse(since)
  return !Number.isNaN(created) && !Number.isNaN(edge) && created >= edge
}

/* ---- соответствие -------------------------------------------------------------- */

export type FitBand = "high" | "mid" | "low"

/** Полоса соответствия: от неё зависит тон числа и шкалы. */
export const fitBand = (fit: number): FitBand => (fit >= 75 ? "high" : fit >= 50 ? "mid" : "low")

export const FIT_TONE: Readonly<Record<FitBand, StatusTone>> = {
  high: "success",
  mid: "warning",
  low: "danger"
}

/** Шкала не выходит за 0..100, даже если сервер прислал лишнее. */
export const fitPercent = (fit: number): number => Math.max(0, Math.min(100, Math.round(fit)))

/* ---- активные фильтры ---------------------------------------------------------- */

export interface ActiveChip {
  readonly key: "q" | "view" | "sort" | "account" | "archived" | "blacklisted" | "analysed" | "rules"
  readonly label: string
}

/**
 * Не умолчательные фильтры для снимаемых чипов под панелью. Быстрый фильтр
 * сюда не входит: он виден во вкладках.
 */
export const activeChips = (
  filters: VacancyFilters,
  accountName: (id: string) => string,
  ruleCount: number
): ReadonlyArray<ActiveChip> => {
  const chips: Array<ActiveChip> = []
  if (filters.q !== "") chips.push({ key: "q", label: `Поиск: ${filters.q}` })
  if (filters.account !== null) {
    chips.push({ key: "account", label: filters.account === "all" ? "Все аккаунты" : `Аккаунт: ${accountName(filters.account)}` })
  }
  if (filters.archived) chips.push({ key: "archived", label: "С архивными" })
  if (filters.blacklisted) chips.push({ key: "blacklisted", label: "С чёрным списком" })
  if (filters.analysed !== "all") {
    chips.push({ key: "analysed", label: filters.analysed === "yes" ? "С ИИ-анализом" : "Без ИИ-анализа" })
  }
  if (ruleCount > 0) chips.push({ key: "rules", label: `Правил: ${ruleCount}` })
  return chips
}

/** Фильтры без одного чипа: умолчание на его месте. */
export const withoutChip = (filters: VacancyFilters, key: ActiveChip["key"]): VacancyFilters => {
  const next = { ...filters, page: 0 }
  switch (key) {
    case "q":
      return { ...next, q: "" }
    case "account":
      return { ...next, account: null }
    case "archived":
      return { ...next, archived: false }
    case "blacklisted":
      return { ...next, blacklisted: false }
    case "analysed":
      return { ...next, analysed: "all" }
    default:
      return next
  }
}

/** Пустое состояние под конкретный фильтр. */
export const emptyCopy = (filters: VacancyFilters, hasRules: boolean): { title: string; description: string } => {
  if (filters.q !== "" || filters.account !== null || filters.archived || filters.blacklisted || filters.analysed !== "all" || hasRules) {
    return { title: "Ничего не найдено", description: "Ослабьте запрос или сбросьте фильтры: под них не подошла ни одна вакансия." }
  }
  switch (filters.view) {
    case "new":
      return { title: "Новых вакансий с прошлого визита нет", description: "Когда поиск найдёт свежие вакансии, они появятся здесь." }
    case "apply":
      return { title: "Подходящих вакансий нет", description: "Пока ни одна вакансия не получила вердикт «Подходит». Оценка идёт по резюме выбранного аккаунта." }
    case "open":
      return { title: "Все вакансии уже с откликом", description: "Для вакансий из списка отклики отправлены или готовятся." }
    case "applied":
      return { title: "Откликов пока нет", description: "Вакансии, на которые отклик отправлен или готовится, появятся здесь." }
    default:
      return {
        title: "Вакансий пока нет",
        description: "Создайте поиск на странице «Поиск вакансий» и запустите его: найденные вакансии появятся здесь."
      }
  }
}
