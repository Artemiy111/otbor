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
  const { vacancy, decision } = item
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

  if (vacancy.blacklisted) {
    facts.push({ label: "Чёрный список", value: vacancy.blacklistLayers.join(", ") || "да", tone: "bad" })
  }
  if (vacancy.analysisRole != null) facts.push({ label: "Роль", value: vacancy.analysisRole, tone: "muted" })
  if (vacancy.employerRating != null) {
    facts.push({ label: "Рейтинг компании", value: String(vacancy.employerRating), tone: "muted" })
  }
  return facts
}

/* ----------------------------- response status ----------------------------- */

interface Status {
  readonly text: string
  readonly color: string
  /** Not sent yet: drawn as a ring instead of a filled dot. */
  readonly pending: boolean
}

/** hh's negotiation state wins over ours: it is what the employer did. */
const HH_STATUS: Record<string, Omit<Status, "pending">> = {
  RESPONSE: { text: "отправлен", color: "#8a94a6" },
  NOT_VIEWED: { text: "не просмотрен", color: "#8a94a6" },
  VIEWED: { text: "просмотрен", color: "#2f7de1" },
  INVITATION: { text: "приглашение", color: "#1a8f4d" },
  INTERVIEW: { text: "приглашение", color: "#1a8f4d" },
  OFFER: { text: "оффер", color: "#0d6b36" },
  DISCARD: { text: "отказ", color: "#d63a3a" },
  DISCARD_AFTER_INTERVIEW: { text: "отказ после собеседования", color: "#d63a3a" },
  HIDDEN: { text: "скрыт", color: "#6b7280" }
}

type LookupApplication = VacancyLookupItem["applications"][number]

const statusOf = (a: LookupApplication): Status => {
  const hh = a.hhStatus === null ? undefined : HH_STATUS[a.hhStatus]
  if (hh !== undefined) return { ...hh, pending: false }
  if (a.hhStatus !== null) return { text: a.hhStatus.toLowerCase(), color: "#6b7280", pending: false }
  switch (a.state) {
    case "submitted":
      return { text: "отправлен", color: "#8a94a6", pending: false }
    case "failed":
      return { text: "ошибка отправки", color: "#d63a3a", pending: true }
    case "skipped":
      return { text: "пропущен", color: "#b8bec9", pending: true }
    default:
      return { text: STATE[a.state] ?? a.state, color: "#b26a00", pending: true }
  }
}

const whoOf = (a: LookupApplication): string =>
  [a.hhAccountName ?? "аккаунт", a.resumeTitle ?? "без резюме"].join(" · ")

const makeDot = (a: LookupApplication, size = 12): HTMLElement => {
  const status = statusOf(a)
  const dot = document.createElement("span")
  dot.setAttribute(MARK, "")
  dot.title = `${whoOf(a)}: ${status.text}`
  const account = a.hhAccountColor ?? "transparent"
  dot.style.cssText = [
    "display:inline-block",
    "flex:none",
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:50%",
    "box-sizing:border-box",
    status.pending ? `border:2px solid ${status.color}` : `background:${status.color}`,
    // The account's colour as a thin halo, so two accounts read apart.
    `box-shadow:0 0 0 2px #fff,0 0 0 3.5px ${account}`,
    "cursor:help"
  ].join(";")
  return dot
}

/** One dot per (account, resume): the newest application of each pair. */
const latestPerResume = (applications: ReadonlyArray<LookupApplication>): ReadonlyArray<LookupApplication> => {
  const seen = new Map<string, LookupApplication>()
  for (const a of applications) {
    const key = `${a.hhAccountId}:${a.resumeId ?? ""}`
    if (!seen.has(key)) seen.set(key, a)
  }
  return [...seen.values()]
}

/* ------------------------------ search cards ------------------------------ */

/** Tags shown on a search card: compact, and only the ones that help choosing. */
const cardTags = (item: VacancyLookupItem): ReadonlyArray<{ readonly text: string; readonly tone: Tone }> => {
  const { vacancy, decision } = item
  const tags: Array<{ text: string; tone: Tone }> = []
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

/** Our row of hh-style tags, set apart from hh's own tags right under them. */
const paintCard = (card: Element, item: VacancyLookupItem | undefined, template: Element | null): void => {
  card.querySelectorAll(`[${MARK}]`).forEach((node) => node.remove())
  card.setAttribute(DONE, "")
  if (item === undefined) return
  const tags = cardTags(item)
  const responses = latestPerResume(item.applications)
  if (tags.length === 0 && responses.length === 0) return

  const row = document.createElement("div")
  row.setAttribute(MARK, "")
  row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0"

  const own = template ?? card.querySelector("[class*='magritte-tag']:not([data-otbor])")
  if (responses.length > 0) {
    const dots = document.createElement("span")
    dots.setAttribute(MARK, "")
    dots.style.cssText = "display:inline-flex;align-items:center;gap:7px;padding:0 4px"
    for (const a of responses) dots.append(makeDot(a))
    row.append(dots)
  }
  for (const tag of tags) row.append(makeTag(own, tag.text, tag.tone))

  const hhTags = card.querySelector("[class*='compensation-labels']")
  if (hhTags !== null) {
    hhTags.after(row)
    return
  }
  const anchor = card.querySelector("[class*='info-section']") ?? card.querySelector("[data-qa='serp-item__title']")?.closest("span")
  anchor?.before(row)
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

const makeRow = (
  template: HTMLElement | null,
  label: string,
  value: string | Node,
  tone: Tone,
  href?: string
): HTMLElement => {
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
  if (typeof value !== "string") {
    dd.append(value)
  } else if (href === undefined) {
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

/** "● Аккаунт · Резюме — статус", one line per (account, resume). */
const responseList = (responses: ReadonlyArray<LookupApplication>): HTMLElement => {
  const list = document.createElement("span")
  list.style.cssText = "display:inline-flex;flex-direction:column;gap:2px;vertical-align:top"
  for (const a of responses) {
    const status = statusOf(a)
    const line = document.createElement("span")
    line.style.cssText = "display:inline-flex;align-items:center;gap:8px"
    const text = document.createElement("span")
    text.append(document.createTextNode(`${whoOf(a)} — `))
    const verdict = document.createElement("b")
    verdict.textContent = status.text
    verdict.style.color = status.color
    text.append(verdict)
    line.append(makeDot(a, 10), text)
    list.append(line)
  }
  return list
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
    const responses = latestPerResume(state.item.applications)
    if (responses.length > 0) rows.push(makeRow(template, "Отклики", responseList(responses), "muted"))
  } else {
    rows.push(makeRow(template, "otbor", "вакансии нет в базе", "muted"))
  }

  if (anchor !== null) anchor.after(...rows)
  else fallbackHost?.append(...rows)
}

/** True when our rows were wiped by hh re-rendering the page. */
export const vacancyRowsMissing = (): boolean => document.querySelector(`[${MARK}]`) === null
