import { BLOCKED_REASON_LABELS } from "@otbor/contract"

/**
 * Фильтр списка откликов и его запись в адресе. Чистый модуль: им пользуются
 * страница списка, страница отклика (очередь «дальше») и тесты.
 */

export type ApplicationTab = "attention" | "active" | "sent" | "all"
export type ApplicationModeFilter = "any_auto" | "manual" | "drafts" | "auto"

export interface ApplicationFilter {
  readonly tab: ApplicationTab
  /** Одно точное состояние (`?state=`); сужает вкладку. */
  readonly state: string | null
  /** Код причины остановки. */
  readonly reason: string | null
  readonly mode: ApplicationModeFilter | null
  /** Id аккаунта или `all`; `null` - не задан, страница берёт свой умолчательный. */
  readonly account: string | null
  /** Подстрока названия вакансии или компании. */
  readonly q: string
}

export const EMPTY_FILTER: ApplicationFilter = {
  tab: "all",
  state: null,
  reason: null,
  mode: null,
  account: null,
  q: ""
}

export const APPLICATION_STATES = [
  "draft",
  "preparing",
  "queued",
  "submitting",
  "submitted",
  "skipped",
  "needs_human",
  "failed"
] as const

/** Состояния каждой вкладки; «Все» - без ограничения. */
export const TAB_STATES: Readonly<Record<ApplicationTab, ReadonlyArray<string>>> = {
  attention: ["needs_human", "failed", "draft"],
  active: ["preparing", "queued", "submitting"],
  sent: ["submitted"],
  all: []
}

export const APPLICATION_TABS: ReadonlyArray<{ readonly value: ApplicationTab; readonly label: string }> = [
  { value: "attention", label: "Требуют вас" },
  { value: "active", label: "В работе" },
  { value: "sent", label: "Отправленные" },
  { value: "all", label: "Все" }
]

const isTab = (value: string | null): value is ApplicationTab =>
  value === "attention" || value === "active" || value === "sent" || value === "all"

const isMode = (value: string | null): value is ApplicationModeFilter =>
  value === "any_auto" || value === "manual" || value === "drafts" || value === "auto"

const isState = (value: string | null): value is string =>
  value !== null && (APPLICATION_STATES as ReadonlyArray<string>).includes(value)

const isReason = (value: string | null): value is string =>
  value !== null && Object.hasOwn(BLOCKED_REASON_LABELS, value)

/** Вкладка, в которую попадает состояние; пропущенные видны только во «Всех». */
export const tabOfState = (state: string): ApplicationTab =>
  (["attention", "active", "sent"] as const).find((tab) => TAB_STATES[tab].includes(state)) ?? "all"

/** Состояния для запроса: точное состояние сильнее вкладки. */
export const filterStates = (filter: ApplicationFilter): ReadonlyArray<string> =>
  filter.state !== null ? [filter.state] : TAB_STATES[filter.tab]

/**
 * Читает фильтр из адреса. Поддерживает `?state=`, `?tab=attention|active|sent|all`,
 * `?reason=`, `?auto=1|manual|drafts|auto`, `?account=` и `?q=`. Неизвестные
 * значения молча отбрасываются: старая закладка не должна ломать страницу.
 */
export const parseFilter = (search: string): ApplicationFilter => {
  const params = new URLSearchParams(search)
  const state = params.get("state")
  const tab = params.get("tab")
  const auto = params.get("auto")
  const account = params.get("account")
  const resolvedState = isState(state) ? state : null
  return {
    tab: isTab(tab) ? tab : resolvedState !== null ? tabOfState(resolvedState) : "all",
    state: resolvedState,
    reason: isReason(params.get("reason")) ? params.get("reason") : null,
    mode: auto === "1" ? "any_auto" : isMode(auto) ? auto : null,
    account: account !== null && account !== "" ? account : null,
    q: params.get("q")?.trim() ?? ""
  }
}

/** Запись фильтра в адрес: значения по умолчанию опускаются, порядок ключей стабилен. */
export const filterToSearch = (filter: ApplicationFilter): string => {
  const params = new URLSearchParams()
  const implicitTab = filter.state !== null ? tabOfState(filter.state) : "all"
  if (filter.tab !== implicitTab) params.set("tab", filter.tab)
  if (filter.state !== null) params.set("state", filter.state)
  if (filter.reason !== null) params.set("reason", filter.reason)
  if (filter.mode !== null) params.set("auto", filter.mode === "any_auto" ? "1" : filter.mode)
  if (filter.account !== null) params.set("account", filter.account)
  if (filter.q !== "") params.set("q", filter.q)
  return params.toString()
}

/** Тот же фильтр без точного состояния: клик по вкладке снимает чип состояния. */
export const withTab = (filter: ApplicationFilter, tab: ApplicationTab): ApplicationFilter => ({
  ...filter,
  tab,
  state: null
})

/**
 * Контекст очереди для страницы отклика: `?from=tab:attention;reason:captcha`.
 * Значения кодируются, поэтому `;` и `:` внутри поиска ничего не ломают.
 */
export const encodeContext = (filter: ApplicationFilter): string => {
  const parts: Array<string> = []
  const implicitTab = filter.state !== null ? tabOfState(filter.state) : "all"
  if (filter.tab !== implicitTab || filter.state === null) parts.push(`tab:${filter.tab}`)
  if (filter.state !== null) parts.push(`state:${filter.state}`)
  if (filter.reason !== null) parts.push(`reason:${filter.reason}`)
  if (filter.mode !== null) parts.push(`auto:${filter.mode}`)
  if (filter.account !== null) parts.push(`account:${encodeURIComponent(filter.account)}`)
  if (filter.q !== "") parts.push(`q:${encodeURIComponent(filter.q)}`)
  return parts.join(";")
}

export const decodeContext = (context: string | null | undefined): ApplicationFilter | null => {
  if (context === null || context === undefined || context.trim() === "") return null
  const params = new URLSearchParams()
  for (const part of context.split(";")) {
    const at = part.indexOf(":")
    if (at <= 0) continue
    const key = part.slice(0, at)
    let value = part.slice(at + 1)
    try {
      value = decodeURIComponent(value)
    } catch {
      continue
    }
    params.set(key, value)
  }
  return parseFilter(params.toString())
}

/** Ссылка на страницу отклика, помнящая список, из которого в неё пришли. */
export const applicationLinkFrom = (id: string, filter: ApplicationFilter): string => {
  const context = encodeContext(filter)
  const base = `/applications/${encodeURIComponent(id)}`
  return context === "" ? base : `${base}?from=${encodeURIComponent(context)}`
}

/** Читает `from` из адреса страницы отклика. */
export const contextFromSearch = (search: string): ApplicationFilter | null =>
  decodeContext(new URLSearchParams(search).get("from"))

/** Строка с полями, по которым фильтруется список; хватает и записи, и позиции прогресса. */
export interface FilterableApplication {
  readonly state: string
  readonly blockedReason?: string | null
  readonly autoRun?: "drafts" | "auto" | null
  readonly hhAccountId: string
  readonly vacancyTitle?: string
  readonly employerName?: string | null
}

/** Тот же фильтр на клиенте: запасной путь, пока сервер не знает `ApplicationsSearch`. */
export const matchesFilter = (row: FilterableApplication, filter: ApplicationFilter): boolean => {
  const states = filterStates(filter)
  if (states.length > 0 && !states.includes(row.state)) return false
  if (filter.reason !== null && row.blockedReason !== filter.reason) return false
  if (filter.mode === "manual" && row.autoRun != null) return false
  if (filter.mode === "any_auto" && row.autoRun == null) return false
  if ((filter.mode === "drafts" || filter.mode === "auto") && row.autoRun !== filter.mode) return false
  if (filter.account !== null && filter.account !== "all" && row.hhAccountId !== filter.account) return false
  if (filter.q !== "") {
    const needle = filter.q.toLowerCase()
    const haystack = `${row.vacancyTitle ?? ""} ${row.employerName ?? ""}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}
