import type { VacancyLookupItem } from "@otbor/contract"
import type { Settings } from "@/messages.ts"

/**
 * Nothing floats over hh.ru. Everything is inserted into hh's own layout by
 * cloning its elements (tags in search cards, "term: value" rows on the
 * vacancy page), so the styling follows hh even when its hashed class names
 * change. Every node we add carries `data-otbor` and is replaced, never
 * duplicated, on the next paint.
 */
const MARK = "data-otbor"
const DONE = "data-otbor-done"

type Tone = "good" | "bad" | "warn" | "muted"

const TONE_COLOR: Record<Tone, string> = {
  good: "#1a8f4d",
  bad: "#d63a3a",
  warn: "#b26a00",
  muted: "#6b7280"
}
const TONE_BG: Record<Tone, string> = {
  good: "rgba(26,143,77,.12)",
  bad: "rgba(214,58,58,.12)",
  warn: "rgba(178,106,0,.14)",
  muted: "rgba(107,114,128,.14)"
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

interface Fact {
  readonly label: string
  readonly value: string
  readonly tone: Tone
}

/** Facts worth showing; the search card uses them as tags, the vacancy page as rows. */
export const factsFor = (item: VacancyLookupItem): ReadonlyArray<Fact> => {
  const { vacancy, decision, applications } = item
  const facts: Array<Fact> = []

  if (decision !== null) {
    const verdict = VERDICT[decision.verdict] ?? { text: decision.verdict, tone: "muted" as Tone }
    facts.push({ label: "Решение", value: `${verdict.text}, fit ${decision.fit}`, tone: verdict.tone })
    const blocked = decision.reasons.find((r) => r.code.startsWith("blocked_"))
    if (blocked !== undefined) {
      facts.push({ label: "Причина отказа", value: blocked.code.replace("blocked_", ""), tone: "bad" })
    }
  }
  if (vacancy.letterRequired === true) facts.push({ label: "Сопроводительное", value: "обязательно", tone: "warn" })
  else if (vacancy.letterRequired === false) facts.push({ label: "Сопроводительное", value: "не требуется", tone: "muted" })

  if (vacancy.hasTest === true) {
    facts.push({
      label: "Тест",
      value: vacancy.testRequired === true ? "есть, обязательный" : "есть",
      tone: vacancy.testRequired === true ? "bad" : "warn"
    })
  } else if (vacancy.hasTest === false) {
    facts.push({ label: "Тест", value: "нет", tone: "muted" })
  }

  if (applications.length > 0) {
    facts.push({
      label: "Отклик",
      value: applications.map((a) => STATE[a.state] ?? a.state).join(", "),
      tone: applications.some((a) => a.state === "submitted") ? "good" : "warn"
    })
  }
  if (vacancy.blacklisted) {
    facts.push({ label: "Чёрный список", value: vacancy.blacklistLayers.join(", ") || "да", tone: "bad" })
  }
  if (vacancy.analysisRole != null) facts.push({ label: "Роль", value: vacancy.analysisRole, tone: "muted" })
  if (vacancy.employerRating != null) {
    facts.push({ label: "Рейтинг компании", value: String(vacancy.employerRating), tone: "muted" })
  }
  return facts
}

/* ------------------------------ search cards ------------------------------ */

/** Tags shown on a search card: compact, and only the ones that help choosing. */
const cardTags = (item: VacancyLookupItem): ReadonlyArray<{ readonly text: string; readonly tone: Tone }> => {
  const { vacancy, decision, applications } = item
  const tags: Array<{ text: string; tone: Tone }> = []
  if (applications.some((a) => a.state === "submitted")) tags.push({ text: "Вы откликнулись", tone: "good" })
  if (vacancy.blacklisted) tags.push({ text: "Чёрный список", tone: "bad" })
  if (decision !== null) {
    const verdict = VERDICT[decision.verdict] ?? { text: decision.verdict, tone: "muted" as Tone }
    tags.push({ text: `fit ${decision.fit} · ${verdict.text}`, tone: verdict.tone })
  }
  if (vacancy.letterRequired === true) tags.push({ text: "Письмо обязательно", tone: "warn" })
  else if (vacancy.letterRequired === false) tags.push({ text: "Без письма", tone: "muted" })
  if (vacancy.hasTest === true) {
    tags.push({ text: vacancy.testRequired === true ? "Тест обязателен" : "Есть тест", tone: vacancy.testRequired === true ? "bad" : "warn" })
  }
  return tags
}

const makeTag = (template: Element | null, text: string, tone: Tone): HTMLElement => {
  let tag: HTMLElement
  if (template !== null) {
    // hh's own tag: same classes, same size, same label markup.
    tag = template.cloneNode(true) as HTMLElement
    const label = tag.querySelector("[class*='magritte-tag__label']") ?? tag
    label.replaceChildren(document.createTextNode(text))
  } else {
    tag = document.createElement("span")
    tag.textContent = text
    tag.style.cssText = "display:inline-block;padding:4px 10px;border-radius:12px;font:14px/20px system-ui,sans-serif"
  }
  tag.setAttribute(MARK, "")
  tag.style.background = TONE_BG[tone]
  tag.style.color = TONE_COLOR[tone]
  for (const inner of tag.querySelectorAll<HTMLElement>("*")) inner.style.color = TONE_COLOR[tone]
  return tag
}

const paintCard = (card: Element, item: VacancyLookupItem | undefined, template: Element | null): void => {
  card.querySelectorAll(`[${MARK}]`).forEach((node) => node.remove())
  card.setAttribute(DONE, "")
  if (item === undefined) return
  const tags = cardTags(item)
  if (tags.length === 0) return

  let host = card.querySelector<HTMLElement>("[class*='compensation-labels']")
  if (host === null) {
    host = document.createElement("div")
    host.setAttribute(MARK, "")
    host.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:8px 0"
    const anchor = card.querySelector("[class*='info-section']") ?? card.querySelector("[data-qa='serp-item__title']")?.closest("span")
    anchor?.before(host)
    if (anchor == null) return
  }
  const own = template ?? card.querySelector("[class*='magritte-tag']:not([data-otbor])")
  for (const tag of tags) host.append(makeTag(own, tag.text, tag.tone))
}

export const paintCards = (items: ReadonlyMap<string, VacancyLookupItem>): void => {
  const template = document.querySelector("[class*='magritte-tag']:not([data-otbor])")
  for (const card of document.querySelectorAll("[data-qa='vacancy-serp__vacancy']")) {
    const id = /\/vacancy\/(\d+)/.exec(
      card.querySelector("a[data-qa='serp-item__title']")?.getAttribute("href") ?? ""
    )?.[1]
    paintCard(card, id === undefined ? undefined : items.get(id), template)
  }
}

/** True when a card exists that was rendered (or re-rendered by hh) since our last paint. */
export const hasUnpaintedCards = (): boolean =>
  document.querySelector(`[data-qa='vacancy-serp__vacancy']:not([${DONE}])`) !== null

/* ------------------------------ vacancy page ------------------------------ */

export interface PanelState {
  readonly status: "loading" | "ok" | "offline" | "error"
  readonly item?: VacancyLookupItem
  readonly message?: string
  readonly saved?: "inserted" | "updated" | "skipped"
}

/** hh's "Опыт работы: …" rows are `div > dl > dt + dd`; one is cloned per fact. */
const rowTemplate = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    "[data-qa='work-formats-text']:has(dl), [data-qa='work-experience-text']:has(dl), [data-qa='work-schedule-by-days-text']:has(dl)"
  )

const makeRow = (template: HTMLElement | null, label: string, value: string, tone: Tone, href?: string): HTMLElement => {
  let row: HTMLElement
  let dt: HTMLElement
  let dd: HTMLElement
  if (template !== null) {
    row = template.cloneNode(true) as HTMLElement
    row.removeAttribute("data-qa")
    // Some of hh's sizing hangs off the original data-qa; copy the result instead.
    const computed = getComputedStyle(template)
    row.style.fontSize = computed.fontSize
    row.style.lineHeight = computed.lineHeight
    dt = row.querySelector("dt") as HTMLElement
    dd = row.querySelector("dd") as HTMLElement
  } else {
    row = document.createElement("div")
    dt = document.createElement("span")
    dd = document.createElement("span")
    dt.style.marginRight = "6px"
    row.append(dt, dd)
  }
  dt.replaceChildren(document.createTextNode(`${label}: `))
  dd.replaceChildren()
  if (href === undefined) {
    dd.textContent = value
  } else {
    const link = document.createElement("a")
    link.href = href
    link.target = "_blank"
    link.rel = "noreferrer"
    link.textContent = value
    link.style.color = "inherit"
    link.style.textDecoration = "underline"
    dd.append(link)
  }
  dd.style.color = TONE_COLOR[tone]
  dd.style.fontWeight = tone === "muted" ? "" : "600"
  row.setAttribute(MARK, "")
  return row
}

export const renderVacancy = (state: PanelState, settings: Settings): void => {
  document.querySelectorAll(`[${MARK}]`).forEach((node) => node.remove())
  const template = rowTemplate()
  const anchor =
    document.querySelector("[data-qa='work-formats-text']") ??
    document.querySelector("[data-qa='common-employment-text']") ??
    document.querySelector("[data-qa='work-experience-text']")
  const fallbackHost = document.querySelector("[data-qa='vacancy-title']")?.parentElement ?? null
  const rows: Array<HTMLElement> = []

  if (state.status === "loading") {
    rows.push(makeRow(template, "otbor", "сохраняю…", "muted"))
  } else if (state.status === "offline") {
    rows.push(makeRow(template, "otbor", "сервер недоступен (otbor up)", "bad"))
  } else if (state.status === "error") {
    rows.push(makeRow(template, "otbor", state.message ?? "ошибка", "bad"))
  } else if (state.item !== undefined) {
    const href = `${settings.webUrl}/vacancies/${state.item.vacancy.id}`
    rows.push(makeRow(template, "otbor", state.saved === "inserted" ? "сохранено, открыть" : "в базе, открыть", "muted", href))
    for (const fact of factsFor(state.item)) rows.push(makeRow(template, fact.label, fact.value, fact.tone))
  } else {
    rows.push(makeRow(template, "otbor", "вакансии нет в базе", "muted"))
  }

  if (anchor !== null) anchor.after(...rows)
  else fallbackHost?.append(...rows)
}

/** True when our rows were wiped by hh re-rendering the page. */
export const vacancyRowsMissing = (): boolean => document.querySelector(`[${MARK}]`) === null
