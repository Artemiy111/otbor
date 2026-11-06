import type { VacancyLookupItem } from "@otbor/contract"
import type { Settings } from "./messages.ts"

const HOST_ID = "otbor-panel-host"

const STYLE = `
:host { all: initial; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 280px;
  font: 13px/1.45 system-ui, -apple-system, sans-serif; color: #18181b; background: #fff;
  border: 1px solid #e4e4e7; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.16); overflow: hidden; }
@media (prefers-color-scheme: dark) { .panel { color: #fafafa; background: #18181b; border-color: #3f3f46; } .row { border-color: #27272a !important; } }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-weight: 600; cursor: pointer; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #a1a1aa; }
.dot.ok { background: #22c55e; } .dot.bad { background: #ef4444; } .dot.warn { background: #f59e0b; }
.grow { flex: 1; }
.body { padding: 0 12px 10px; } .collapsed .body { display: none; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid #f4f4f5; }
.row span:first-child { color: #71717a; }
.v-good { color: #16a34a; font-weight: 600; } .v-bad { color: #dc2626; font-weight: 600; } .v-warn { color: #d97706; font-weight: 600; }
a { color: #2563eb; text-decoration: none; } a:hover { text-decoration: underline; }
.note { color: #71717a; padding: 4px 0 8px; }
`

type Tone = "good" | "bad" | "warn" | ""

interface Row {
  readonly label: string
  readonly value: string
  readonly tone?: Tone
}

const VERDICT: Record<string, { readonly text: string; readonly tone: Tone }> = {
  apply: { text: "откликаться", tone: "good" },
  draft: { text: "черновик", tone: "warn" },
  skip: { text: "пропустить", tone: "bad" }
}

const STATE: Record<string, string> = {
  draft: "черновик",
  queued: "в очереди",
  submitting: "отправляется",
  submitted: "отправлен",
  skipped: "пропущен",
  needs_human: "нужен человек",
  failed: "ошибка"
}

const boolRow = (
  label: string,
  value: boolean | null | undefined,
  yes: string,
  no: string,
  yesTone: Tone
): Row =>
  value === null || value === undefined
    ? { label, value: "неизвестно" }
    : value
    ? { label, value: yes, tone: yesTone }
    : { label, value: no, tone: "good" }

export const rowsFor = (item: VacancyLookupItem): ReadonlyArray<Row> => {
  const { vacancy, decision, applications } = item
  const rows: Array<Row> = []

  rows.push(boolRow("Сопроводительное", vacancy.letterRequired, "обязательно", "не требуется", "warn"))
  if (vacancy.hasTest === true) {
    rows.push({
      label: "Тест",
      value: vacancy.testRequired === true ? "есть, обязательный" : "есть",
      tone: vacancy.testRequired === true ? "bad" : "warn"
    })
  } else {
    rows.push(boolRow("Тест", vacancy.hasTest, "есть", "нет", "warn"))
  }

  if (decision !== null) {
    const verdict = VERDICT[decision.verdict] ?? { text: decision.verdict, tone: "" as Tone }
    rows.push({ label: "Решение", value: verdict.text, tone: verdict.tone })
    rows.push({ label: "Fit / приоритет", value: `${decision.fit} / ${Math.round(decision.priority)}` })
    const blocked = decision.reasons.find((r) => r.code.startsWith("blocked_"))
    if (blocked !== undefined) rows.push({ label: "Причина", value: blocked.code.replace("blocked_", ""), tone: "bad" })
  }

  if (applications.length > 0) {
    rows.push({
      label: "Отклик",
      value: applications.map((a) => STATE[a.state] ?? a.state).join(", "),
      tone: applications.some((a) => a.state === "submitted") ? "good" : "warn"
    })
  }
  if (vacancy.blacklisted) rows.push({ label: "Чёрный список", value: vacancy.blacklistLayers.join(", ") || "да", tone: "bad" })
  if (vacancy.archived) rows.push({ label: "Статус", value: "в архиве", tone: "bad" })
  if (vacancy.analysisRole != null) rows.push({ label: "Роль", value: vacancy.analysisRole })
  if (vacancy.employerRating != null) rows.push({ label: "Рейтинг компании", value: String(vacancy.employerRating) })
  if (vacancy.responsesVacancy != null) rows.push({ label: "Откликов", value: String(vacancy.responsesVacancy) })
  return rows
}

export interface PanelState {
  readonly status: "loading" | "ok" | "offline" | "error"
  readonly item?: VacancyLookupItem
  readonly message?: string
  readonly saved?: "inserted" | "updated" | "skipped"
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export const renderPanel = (state: PanelState, settings: Settings): void => {
  let host = document.getElementById(HOST_ID)
  if (host === null) {
    host = document.createElement("div")
    host.id = HOST_ID
    const shadow = host.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = STYLE
    shadow.append(style, el("div", "panel"))
    document.documentElement.appendChild(host)
  }
  const shadow = host.shadowRoot!
  const panel = shadow.querySelector(".panel") as HTMLElement
  const wasCollapsed = panel.classList.contains("collapsed")
  panel.replaceChildren()
  if (wasCollapsed) panel.classList.add("collapsed")

  const head = el("div", "head")
  const dot = el("span", `dot ${state.status === "ok" ? "ok" : state.status === "loading" ? "warn" : "bad"}`)
  head.append(dot, el("span", "grow", "otbor"))
  const label =
    state.status === "loading"
      ? "…"
      : state.status === "offline"
      ? "сервер недоступен"
      : state.status === "error"
      ? "ошибка"
      : state.saved === "inserted"
      ? "сохранено"
      : "в базе"
  head.append(el("span", "", label))
  head.addEventListener("click", () => panel.classList.toggle("collapsed"))
  panel.append(head)

  const body = el("div", "body")
  if (state.status === "offline" || state.status === "error") {
    body.append(el("div", "note", state.message ?? "Запустите `otbor up`."))
  } else if (state.item !== undefined) {
    for (const row of rowsFor(state.item)) {
      const line = el("div", "row")
      line.append(el("span", "", row.label), el("span", row.tone ? `v-${row.tone}` : "", row.value))
      body.append(line)
    }
    const link = el("a", "", "Открыть в otbor")
    link.href = `${settings.webUrl}/vacancies/${state.item.vacancy.id}`
    link.target = "_blank"
    link.rel = "noreferrer"
    const footer = el("div", "row")
    footer.append(link)
    body.append(footer)
  } else if (state.status === "ok") {
    body.append(el("div", "note", "Вакансии нет в базе."))
  }
  panel.append(body)
}

/** Short badge for a search-result card. */
export const badgeText = (item: VacancyLookupItem): { readonly text: string; readonly tone: Tone } => {
  const parts: Array<string> = []
  let tone: Tone = ""
  const { vacancy, decision, applications } = item
  if (applications.some((a) => a.state === "submitted")) {
    parts.push("откликнулись")
    tone = "good"
  }
  if (vacancy.blacklisted) {
    parts.push("чёрный список")
    tone = "bad"
  }
  if (decision !== null) parts.push(`fit ${decision.fit}`)
  if (vacancy.letterRequired === true) parts.push("✉ обяз.")
  if (vacancy.hasTest === true) parts.push(vacancy.testRequired === true ? "тест обяз." : "тест")
  if (tone === "" && decision !== null) tone = decision.verdict === "apply" ? "good" : decision.verdict === "skip" ? "bad" : "warn"
  return { text: parts.length === 0 ? "в базе" : parts.join(" · "), tone }
}

const BADGE_CLASS = "otbor-badge"
const COLORS: Record<string, string> = { good: "#16a34a", bad: "#dc2626", warn: "#d97706", "": "#71717a" }

export const paintBadges = (items: ReadonlyMap<string, VacancyLookupItem>): void => {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[data-qa="serp-item__title"], a[href*="/vacancy/"][data-qa*="title"]')
  for (const link of links) {
    const id = /\/vacancy\/(\d+)/.exec(link.getAttribute("href") ?? "")?.[1]
    const item = id === undefined ? undefined : items.get(id)
    if (item === undefined) continue
    const parent = link.closest("[data-qa^='vacancy-serp__vacancy']") ?? link.parentElement
    if (parent === null) continue
    parent.querySelector(`.${BADGE_CLASS}`)?.remove()
    const { text, tone } = badgeText(item)
    const badge = document.createElement("span")
    badge.className = BADGE_CLASS
    badge.textContent = `otbor · ${text}`
    badge.style.cssText = `display:inline-block;margin:4px 0;padding:1px 8px;border-radius:999px;font:12px/1.6 system-ui,sans-serif;color:#fff;background:${COLORS[tone]}`
    link.closest("h2, h3, span, div")?.after(badge)
  }
}
