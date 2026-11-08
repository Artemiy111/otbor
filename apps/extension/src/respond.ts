import type {
  BrowserDraft,
  BrowserDrafts,
  BrowserSubmitResult,
  FormAnswer,
  FormQuestion,
  ResponseForm
} from "@otbor/contract"
import { parseNegotiations, parseResponseForm, parseResponseResumes } from "@otbor/hh"
import type { Request, Settings } from "@/messages.ts"
import { chooseDraft, isResumeHash, resumeHashOfId, resumeIdOfHash, resumeToSelect } from "@/resumePick.ts"

/**
 * hh's own response form, opened by the operator (the `/applicant/vacancy_response`
 * page or the response popup on a vacancy page).
 *
 * - Autofill: when otbor has a draft for the vacancy, its answers go into the
 *   test once per form, and its letter into every empty letter field the moment
 *   one shows up: the field of the form, or the letter popup hh opens right
 *   after a quick response. Nothing is clicked except hh's "add a letter"
 *   toggle; the operator presses the buttons.
 * - Record: when the operator presses hh's button and hh shows "you
 *   responded", what was on the form is sent to the cloud, which checks the
 *   evidence and stores the application as submitted.
 *
 * Selectors are the harness's (`packages/harness/src/browser/core.ts`), plus a
 * looser match for the letter field, whose markup differs between hh's forms.
 */

const LETTER_SELECTOR =
  'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[data-qa*="letter"], textarea[name="letter"], [contenteditable="true"][data-qa*="letter"]'
/** "Добавить сопроводительное": `add-cover-letter` in the popup (seen 2026-11-06), the older toggle elsewhere. */
const LETTER_TOGGLE_SELECTOR = '[data-qa="add-cover-letter"], [data-qa="vacancy-response-letter-toggle"]'
const SUBMIT_SELECTOR = '[data-qa="vacancy-response-submit-popup"]'
/** "Отправить" of the letter dialog of a response hh already holds. */
const LETTER_SUBMIT_SELECTOR = '[data-qa="vacancy-response-letter-submit"]'
const SUCCESS_SELECTOR = '[data-qa="responded-success-attach-cover-letter"]'
const RESUME_SELECTED_SELECTOR = '[data-qa="resume-title"]'
/** The options of the opened resume select; each is keyed by the resume's hash. */
const RESUME_OPTION_SELECTOR = 'label[role="option"][data-magritte-select-option]'
const RESUME_CHOSEN_SELECTOR = `${RESUME_OPTION_SELECTOR}[aria-selected="true"]`
/** The one-click "Откликнуться" on a vacancy page: without a form hh responds at once. */
const QUICK_RESPONSE_SELECTOR =
  '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]'
const TASK_SELECTOR = '[data-qa="task-body"]'
/** Words that name a letter field when its data-qa does not. */
const LETTER_HINT_RE = /letter|cover|сопровод|письм/i

const FILLED = "otborFilled"
const RESUME_PICKED = "otborResume"
const OPENED_KEY = "otbor:opened:"
const PENDING_KEY = "otbor:pending-submit"
/** A submit that reloaded the page is still checked on the next page this long. */
const PENDING_TTL_MS = 90_000

type Send = <T>(request: Request) => Promise<T>
type Field = HTMLTextAreaElement | HTMLElement

/* -------------------------------------------------------------------------- */
/* Page reading                                                               */
/* -------------------------------------------------------------------------- */

/** The card whose "Откликнуться" opened the popup on a search page: the popup itself names no vacancy. */
const SERP_CARD_SELECTOR = '[data-qa="vacancy-serp__vacancy"]'
const SERP_RESPONSE_SELECTOR = '[data-qa*="vacancy_response"], [data-qa*="vacancy-response"]'
let serpVacancyId: string | null = null

const rememberSerpVacancy = (target: Element): void => {
  if (target.closest(SERP_RESPONSE_SELECTOR) === null) return
  const href = target.closest(SERP_CARD_SELECTOR)?.querySelector("a[data-qa='serp-item__title']")?.getAttribute("href") ?? ""
  const id = /\/vacancy\/(\d+)/.exec(href)?.[1]
  if (id !== undefined) serpVacancyId = id
}

const vacancyExternalId = (): string | null => {
  const url = new URL(location.href)
  if (url.pathname.startsWith("/search/vacancy")) return serpVacancyId
  const fromUrl = url.searchParams.get("vacancyId") ?? /^\/vacancy\/(\d+)/.exec(url.pathname)?.[1] ?? null
  if (fromUrl !== null && /^\d+$/.test(fromUrl)) return fromUrl
  const input = document.querySelector<HTMLInputElement>('input[name="vacancyId"], input[name="vacancy_id"]')
  return input?.value && /^\d+$/.test(input.value) ? input.value : null
}

/**
 * hh's id of the user logged in on this page, from its initial state. One
 * browser may hold several hh users (Zen containers); this says which one.
 */
const HHID_RE = /"hhid"\s*:\s*"?(\d+)/
const HHID_KEY = "otbor:hhid"
let hhidLookup: Promise<string | null> | null = null

const pageHhid = (): Promise<string | null> => {
  const template = document.getElementById("HH-Lux-InitialState")
  const text = template instanceof HTMLTemplateElement ? template.content.textContent : template?.textContent
  const own = HHID_RE.exec(text ?? "")?.[1]
  if (own !== undefined) return Promise.resolve(own)
  try {
    const kept = sessionStorage.getItem(HHID_KEY)
    if (kept !== null) return Promise.resolve(kept)
  } catch {
    // no storage: ask hh below
  }
  // The home page of the same tab (same container cookies) carries it, as `otbor hh login` reads it.
  hhidLookup ??= fetch("/", { credentials: "same-origin" })
    .then((response) => response.text())
    .then((html) => {
      const found = HHID_RE.exec(html)?.[1] ?? null
      try {
        if (found !== null) sessionStorage.setItem(HHID_KEY, found)
      } catch {
        // fine without the cache
      }
      return found
    })
    .catch(() => null)
  return hhidLookup
}

const visible = (element: Element): boolean =>
  (element as HTMLElement).offsetParent !== null || element.getClientRects().length > 0

/** A field named like a letter by its attributes or its label. */
const looksLikeLetter = (field: Element): boolean => {
  const name = field.getAttribute("name") ?? ""
  if (name.startsWith("task_")) return false
  const own = [name, field.getAttribute("data-qa"), field.getAttribute("placeholder"), field.getAttribute("aria-label")]
    .filter(Boolean)
    .join(" ")
  if (LETTER_HINT_RE.test(own)) return true
  const id = field.getAttribute("id")
  const label = id === null ? null : document.querySelector(`label[for="${CSS.escape(id)}"]`)
  const near = (label ?? field.closest("label"))?.textContent ?? ""
  return LETTER_HINT_RE.test(near)
}

const letterFields = (): Array<Field> => {
  const out: Array<Field> = []
  for (const field of document.querySelectorAll<Field>(LETTER_SELECTOR)) if (visible(field)) out.push(field)
  // hh's other letter forms (the popup after a quick response) carry no `letter` data-qa.
  for (const field of document.querySelectorAll<Field>('textarea, [contenteditable="true"]')) {
    if (!out.includes(field) && visible(field) && looksLikeLetter(field)) out.push(field)
  }
  return out
}

const letterField = (): Field | null => letterFields()[0] ?? null

const valueOf = (field: Field): string =>
  field instanceof HTMLTextAreaElement ? field.value : (field.textContent ?? "")

const respondedNow = (): boolean =>
  document.querySelector(SUCCESS_SELECTOR) !== null || /вы\s+откликнулись/i.test(document.body?.innerText ?? "")

/** The markup the cloud reads to confirm the response itself. */
const evidence = (): string => {
  const marker = document.querySelector(SUCCESS_SELECTOR)
  if (marker !== null) return marker.outerHTML.slice(0, 4000)
  const text = /[^\n]{0,120}вы\s+откликнулись[^\n]{0,120}/i.exec(document.body?.innerText ?? "")?.[0]
  return text === undefined ? "" : `<p>${text.replace(/[<>&]/g, " ")}</p>`
}

const liveForm = (): ResponseForm => parseResponseForm(document.documentElement.outerHTML, location.href)

const escape = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

/** What the form holds right now, as kit answers. */
const readAnswers = (form: ResponseForm, draft: BrowserDraft | null): Array<FormAnswer> => {
  const out: Array<FormAnswer> = []
  for (const question of form.questions) {
    const planned = draft?.answers.find((answer) => answer.questionId === question.id)
    const base = { questionId: question.id, hard: false, needsHuman: false }
    if (question.kind === "single" || question.kind === "multiple") {
      const optionIds = [
        ...document.querySelectorAll<HTMLInputElement>(`input[name="task_${escape(question.id)}"]:checked`)
      ].map((input) => input.value)
      if (optionIds.length === 0) continue
      const same = planned !== undefined && [...(planned.optionIds ?? [])].sort().join("|") === [...optionIds].sort().join("|")
      out.push({ ...base, optionIds, source: same ? planned.source : "human", hard: same ? planned.hard : false })
    } else {
      const text = document
        .querySelector<HTMLTextAreaElement>(`textarea[name="task_${escape(question.id)}_text"]`)
        ?.value.trim()
      if (text === undefined || text === "") continue
      const same = planned !== undefined && (planned.text ?? "").trim() === text
      out.push({ ...base, text, source: same ? planned.source : "human", hard: same ? planned.hard : false })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Filling                                                                    */
/* -------------------------------------------------------------------------- */

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** React keeps its own value; the native setter plus an input event updates both. */
const setText = (field: Field, text: string): void => {
  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(field, text)
  } else {
    field.focus()
    field.textContent = text
  }
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
}

const fillQuestion = (question: FormQuestion, answer: FormAnswer): boolean => {
  if (question.kind === "single" || question.kind === "multiple") {
    const offered = new Set(question.options.map((option) => option.id))
    const ids = (answer.optionIds ?? []).filter((id) => offered.has(id))
    if (ids.length === 0) return false
    const name = `input[name="task_${escape(question.id)}"]`
    // Something already chosen is the operator's choice.
    if (document.querySelector(`${name}:checked`) !== null) return false
    for (const id of question.kind === "single" ? ids.slice(0, 1) : ids) {
      const input = document.querySelector<HTMLInputElement>(`${name}[value="${escape(id)}"]`)
      if (input !== null && !input.checked) input.click()
    }
    return true
  }
  const text = (answer.text ?? "").trim()
  const field = document.querySelector<HTMLTextAreaElement>(`textarea[name="task_${escape(question.id)}_text"]`)
  if (text === "" || field === null || field.value.trim() !== "") return false
  setText(field, question.maxLength ? text.slice(0, question.maxLength) : text)
  return true
}

/* ---- resume of the form: by hh's id, never by title ---------------------- */

/**
 * The form names the selected resume only by title, and titles repeat. The
 * options carry the resume's hash (`data-magritte-select-option`); the page
 * state maps hh's numeric id (`resume.external_id`) to that hash. The page does
 * not say which resume is preselected, so the selected hash is learned from:
 * what this extension selected, what the operator clicked, or (once) an
 * opened list whose `aria-selected` option is read.
 */
let knownHash: string | null = null
/** The card the hash was learned for: a form that was rebuilt starts unknown again. */
let knownFor: Element | null = null
let probedAt = 0
const PROBE_COOLDOWN_MS = 5000

const resumeCard = (): HTMLElement | null => {
  const title = document.querySelector<HTMLElement>(RESUME_SELECTED_SELECTOR)
  return title === null ? null : (title.closest<HTMLElement>('[role="button"]') ?? title)
}

const rememberHash = (hash: string | null): void => {
  knownHash = hash
  knownFor = hash === null ? null : document.querySelector(RESUME_SELECTED_SELECTOR)
}

/** id → hash of the resumes the form offers, from the page state. */
const pageResumes = () => {
  const state = document.getElementById("HH-Lux-InitialState")
  return state === null ? [] : parseResponseResumes(state.outerHTML).resumes
}

const optionElements = (): Array<HTMLElement> => [...document.querySelectorAll<HTMLElement>(RESUME_OPTION_SELECTOR)]
const listOpen = (): boolean => document.querySelector(RESUME_OPTION_SELECTOR) !== null

/** Hash of the `aria-selected` option of the opened list, else null. */
const chosenHashInList = (): string | null =>
  document.querySelector(RESUME_CHOSEN_SELECTOR)?.getAttribute("data-magritte-select-option") ?? null

/**
 * Keeps the hash of the option the operator picks. Capture phase, so it runs
 * before hh's handlers (which close the list and remove the options).
 */
const watchResumePicks = (): void => {
  const take = (event: Event) => {
    const option = event.target instanceof Element ? event.target.closest(RESUME_OPTION_SELECTOR) : null
    const hash = option?.getAttribute("data-magritte-select-option")
    if (hash !== null && hash !== undefined && hash !== "") rememberHash(hash)
  }
  document.addEventListener("click", take, true)
  document.addEventListener("change", take, true)
}

/**
 * Opens hh's resume list. The form is in the HTML before React attaches its
 * handlers, so the first click may do nothing: click again when no option shows
 * within ~2 s (4 tries). Never clicks while the list is open: that would close it.
 */
const openResumeList = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (listOpen()) return true
    const card = resumeCard()
    if (card === null) return false
    card.click()
    for (let waited = 0; waited < 2000; waited += 100) {
      await wait(100)
      if (listOpen()) return true
    }
  }
  return listOpen()
}

const closeResumeList = async (): Promise<void> => {
  if (!listOpen()) return
  const target = document.activeElement ?? document.body
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }))
  }
  for (let waited = 0; waited < 1000 && listOpen(); waited += 100) await wait(100)
}

/** hh's id of the resume the form has selected, or null while it cannot be told. */
const selectedResumeId = async (): Promise<string | null> => {
  const resumes = pageResumes()
  if (resumes.length === 0 || resumeCard() === null) return null
  if (knownHash !== null && knownFor !== null && knownFor.isConnected) return resumeIdOfHash(resumes, knownHash)
  if (!listOpen() && Date.now() - probedAt < PROBE_COOLDOWN_MS) return null
  probedAt = Date.now()
  const wasOpen = listOpen()
  if (!wasOpen && !(await openResumeList())) return null
  const hash = chosenHashInList()
  if (!wasOpen) await closeResumeList()
  if (hash === null) return null
  rememberHash(hash)
  return resumeIdOfHash(resumes, hash)
}

/**
 * The draft for the form on screen: the one of the resume the form has
 * selected (by hh's id), else the only one there is.
 */
const pickDraft = async (
  drafts: ReadonlyArray<BrowserDraft>,
  usable: (draft: BrowserDraft) => boolean
): Promise<{ readonly draft: BrowserDraft; readonly matched: boolean } | null> => {
  const candidates = drafts.filter(usable)
  if (candidates.length === 0) return null
  return chooseDraft(candidates, await selectedResumeId())
}

/**
 * Selects the resume with hh's id `wantedId` in hh's resume select, when
 * another is selected, and verifies it by `aria-selected`. Only opens the
 * select and clicks an option; the form sends nothing by it.
 */
const selectResume = async (wantedId: string): Promise<boolean> => {
  const resumes = pageResumes()
  const hash = resumeHashOfId(resumes, wantedId)
  if (hash === null || !isResumeHash(hash)) return false
  if ((await selectedResumeId()) === wantedId) return true
  if (!(await openResumeList())) return false
  const option = optionElements().find((item) => item.getAttribute("data-magritte-select-option") === hash)
  if (option === undefined) {
    await closeResumeList()
    return false
  }
  option.click()
  rememberHash(hash)
  let ok = false
  for (let i = 0; i < 20 && !ok; i++) {
    await wait(100)
    // The list closes after a pick and its options leave the DOM: reopen to read the choice.
    if (!listOpen() && !(await openResumeList())) continue
    ok = chosenHashInList() === hash
  }
  await closeResumeList()
  if (!ok) rememberHash(null)
  return ok
}

/** A draft the operator could still send: not sent, not being sent by otbor. */
const sendable = (draft: BrowserDraft): boolean =>
  (draft.state === "draft" || draft.state === "needs_human" || draft.state === "failed") &&
  (draft.letter !== null || draft.answers.length > 0)

/**
 * Before a response the kit's letter; once hh holds the response, the letter
 * kept for it (the unsent draft) first.
 */
const letterOf = (draft: BrowserDraft, responded: boolean): string | null =>
  responded ? (draft.pendingLetter ?? draft.letter) : (draft.letter ?? draft.pendingLetter)

/* -------------------------------------------------------------------------- */
/* Notice                                                                     */
/* -------------------------------------------------------------------------- */

const TOAST_ID = "otbor-toast"

export const toast = (text: string, tone: "good" | "warn" | "bad" = "good"): void => {
  document.getElementById(TOAST_ID)?.remove()
  const host = document.createElement("div")
  host.id = TOAST_ID
  host.setAttribute("data-otbor", "toast")
  const shadow = host.attachShadow({ mode: "open" })
  const color = tone === "good" ? "#1a8f4d" : tone === "warn" ? "#b26a00" : "#d63a3a"
  const box = document.createElement("div")
  box.textContent = text
  box.setAttribute(
    "style",
    `position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:10px 14px;` +
      `border-radius:10px;background:#fff;color:#111;border-left:4px solid ${color};` +
      `box-shadow:0 4px 18px rgba(0,0,0,.18);font:13px/1.4 system-ui,sans-serif;white-space:pre-line`
  )
  shadow.append(box)
  document.documentElement.append(host)
  setTimeout(() => host.remove(), 7000)
}

/* -------------------------------------------------------------------------- */
/* The controller                                                             */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  readonly kind: "submit" | "letter"
  readonly externalId: string
  /** hh's id of the resume the form had selected, when it was known at the click. */
  readonly resumeExternalId: string | null
  readonly letter: string | null
  readonly answers: ReadonlyArray<FormAnswer>
  readonly formHash: string | null
  readonly respondedBefore: boolean
  readonly at: number
}

/** The selected resume's hh id when already known (no list is opened). */
const knownResumeId = (): string | null =>
  knownHash !== null && knownFor !== null && knownFor.isConnected ? resumeIdOfHash(pageResumes(), knownHash) : null

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const startResponseWatch = (
  send: Send
): { readonly check: () => void; readonly maybeOpen: (settings: Settings) => Promise<void> } => {
  watchResumePicks()
  const cache = new Map<string, { readonly at: number; readonly value: Promise<BrowserDrafts> }>()

  const draftsFor = (externalId: string): Promise<BrowserDrafts> => {
    const hit = cache.get(externalId)
    if (hit !== undefined && Date.now() - hit.at < 30_000) return hit.value
    const value = pageHhid().then((hhid) => send<BrowserDrafts>({ type: "drafts", externalId, hhid }))
    cache.set(externalId, { at: Date.now(), value })
    value.catch(() => cache.delete(externalId))
    return value
  }

  /** The draft pasted into the form of a vacancy, to tell its answers from the operator's. */
  const pasted = new Map<string, BrowserDraft>()
  let busy = false

  /**
   * Once per response form: when the selected resume has no draft and exactly
   * one other resume of this account has one, that resume is selected.
   */
  const pickResume = async (externalId: string): Promise<string | null> => {
    const anchor = document.querySelector<HTMLElement>(SUBMIT_SELECTOR)
    if (anchor === null || anchor.dataset[RESUME_PICKED] !== undefined) return null
    if (document.querySelector(RESUME_SELECTED_SELECTOR) === null) return null
    anchor.dataset[RESUME_PICKED] = "pending"
    const { drafts } = await draftsFor(externalId)
    const usable = drafts.filter(sendable)
    if (usable.length === 0) {
      anchor.dataset[RESUME_PICKED] = "none"
      return null
    }
    const wanted = resumeToSelect(usable, await selectedResumeId())
    if (wanted === null || wanted.resumeExternalId === null) {
      anchor.dataset[RESUME_PICKED] = "none"
      return null
    }
    const name = wanted.resumeTitle ?? wanted.resumeExternalId
    const ok = await selectResume(wanted.resumeExternalId)
    anchor.dataset[RESUME_PICKED] = ok ? "done" : "failed"
    if (!ok) toast(`otbor: не получилось выбрать резюме «${name}» — выберите его сами`, "warn")
    return ok ? `резюме «${name}»` : null
  }

  /** Test answers, once per response form (the submit button carries the mark). */
  const fillAnswers = async (externalId: string): Promise<string | null> => {
    const anchor = document.querySelector<HTMLElement>(SUBMIT_SELECTOR)
    if (anchor === null || anchor.dataset[FILLED] !== undefined) return null
    if (document.querySelector(TASK_SELECTOR) === null) return null
    anchor.dataset[FILLED] = "pending"
    try {
      const { drafts } = await draftsFor(externalId)
      const picked = await pickDraft(drafts, (draft) => draft.state !== "submitted" && draft.answers.length > 0)
      if (picked === null) {
        anchor.dataset[FILLED] = "none"
        return null
      }
      pasted.set(externalId, picked.draft)
      const form = liveForm()
      let answered = 0
      for (const question of form.questions) {
        const answer = picked.draft.answers.find((item) => item.questionId === question.id)
        if (answer !== undefined && fillQuestion(question, answer)) answered++
      }
      anchor.dataset[FILLED] = "done"
      if (answered === 0) return null
      const changed =
        picked.draft.formHash !== null && picked.draft.formHash !== "no-form" && picked.draft.formHash !== form.formHash
      return `ответы ${answered} из ${form.questions.length}${changed ? " (форма изменилась — проверьте)" : ""}`
    } catch (error) {
      delete anchor.dataset[FILLED]
      throw error
    }
  }

  /** The letter, into each empty letter field once, whenever one appears. */
  const fillLetters = async (externalId: string): Promise<{ text: string; draft: BrowserDraft; matched: boolean } | null> => {
    let fields = letterFields().filter((field) => field.dataset[FILLED] === undefined)
    const toggle = document.querySelector<HTMLElement>(LETTER_TOGGLE_SELECTOR)
    if (fields.length === 0 && (toggle === null || toggle.dataset[FILLED] !== undefined)) return null
    const responded = respondedNow()
    const { drafts } = await draftsFor(externalId)
    const picked = await pickDraft(drafts, (draft) => letterOf(draft, responded) !== null)
    if (picked === null) {
      for (const field of fields) field.dataset[FILLED] = "none"
      if (toggle !== null) toggle.dataset[FILLED] = "none"
      return null
    }
    const text = letterOf(picked.draft, responded)!
    if (fields.length === 0 && toggle !== null) {
      // The field hides behind "Добавить сопроводительное".
      toggle.dataset[FILLED] = "done"
      toggle.click()
      for (let i = 0; i < 20 && fields.length === 0; i++) {
        await wait(100)
        fields = letterFields().filter((field) => field.dataset[FILLED] === undefined)
      }
    }
    let filled = false
    for (const field of fields) {
      field.dataset[FILLED] = "done"
      // Typed by the operator, or kept by hh from an earlier try: not ours to replace.
      if (valueOf(field).trim() !== "") continue
      setText(field, text)
      filled = true
    }
    return filled ? { text, draft: picked.draft, matched: picked.matched } : null
  }

  const autofill = async (): Promise<void> => {
    if (busy) return
    const externalId = vacancyExternalId()
    if (externalId === null) return
    busy = true
    try {
      const picked = await pickResume(externalId)
      const answers = await fillAnswers(externalId)
      const letter = await fillLetters(externalId)
      const parts = [picked, answers, letter === null ? null : "письмо"].filter((part): part is string => part !== null)
      if (parts.length === 0) return
      const draft = letter?.draft ?? pasted.get(externalId)
      const whose = draft?.resumeTitle ?? draft?.accountName ?? "черновик"
      const matched = letter?.matched ?? true
      const note = matched ? "" : "\nВ форме выбрано другое резюме: проверьте его."
      toast(`otbor: вставлено из черновика (${whose}): ${parts.join(", ")}.${note}`, matched ? "good" : "warn")
    } catch (error) {
      console.warn("[otbor] autofill", describe(error))
    } finally {
      busy = false
    }
  }

  /* ---- recording --------------------------------------------------------- */

  const snapshot = (kind: Snapshot["kind"], externalId: string): Snapshot => {
    let form: ResponseForm | null = null
    try {
      form = kind === "submit" ? liveForm() : null
    } catch {
      form = null
    }
    const field = letterField()
    return {
      kind,
      externalId,
      // Only what is already known: opening the list at the click would disturb the form.
      resumeExternalId: knownResumeId(),
      letter: field === null ? null : valueOf(field).trim() || null,
      answers: form === null ? [] : readAnswers(form, pasted.get(externalId) ?? null),
      formHash: form !== null && form.layout === "known" && form.questions.length > 0 ? form.formHash : null,
      respondedBefore: respondedNow(),
      at: Date.now()
    }
  }

  const savePending = (snap: Snapshot) => {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(snap))
    } catch {
      // Private mode: the in-page check still runs.
    }
  }
  const takePending = (): Snapshot | null => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY)
      sessionStorage.removeItem(PENDING_KEY)
      if (raw === null) return null
      const snap = JSON.parse(raw) as Snapshot
      return Date.now() - snap.at < PENDING_TTL_MS ? snap : null
    } catch {
      return null
    }
  }

  /**
   * The resume of a response whose form named none (hh responds in one click
   * with the account's resume): hh's own list of responses says which resume
   * each response was sent with. The list may show the new response a moment
   * late, so it is read a few times; null leaves the resume to `otbor hh sync`.
   */
  const resumeFromNegotiations = async (externalId: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await wait(1500)
      try {
        const response = await fetch("/applicant/negotiations?page=0", { credentials: "same-origin" })
        if (!response.ok) continue
        const page = parseNegotiations(await response.text())
        if (!page.readable) continue
        const topic = page.topics.find((item) => item.vacancyId === externalId)
        if (topic !== undefined) return topic.resumeId
      } catch {
        // offline or blocked: the sync fills the resume later
      }
    }
    return null
  }

  const record = async (snap: Snapshot): Promise<void> => {
    try {
      // The id of the form's resume when known, else hh's list of responses names it.
      const resumeExternalId =
        snap.resumeExternalId ?? (snap.kind === "submit" ? await resumeFromNegotiations(snap.externalId) : null)
      const result = await send<BrowserSubmitResult>({
        type: "record",
        payload: {
          kind: snap.kind,
          externalId: snap.externalId,
          hhid: await pageHhid(),
          // The title identifies nothing; the cloud resolves the resume by id.
          resumeTitle: null,
          resumeExternalId,
          letter: snap.letter,
          answers: snap.answers,
          formHash: snap.formHash,
          url: location.href,
          evidence: evidence()
        }
      })
      cache.delete(snap.externalId)
      const what = snap.kind === "letter" ? "письмо" : "отклик"
      switch (result.status) {
        case "recorded":
          toast(`otbor: ${what} сохранён в базе.`)
          break
        case "already":
          break
        case "in_flight":
          toast("otbor: этот отклик уже отправляет otbor — его сверит reconcile.", "warn")
          break
        default:
          toast(`otbor: ${what} не сохранён — ${result.message ?? result.status}`, "bad")
      }
    } catch (error) {
      toast(`otbor: отклик не сохранён в базе — ${describe(error)}`, "bad")
    }
  }

  /** Waits for hh to confirm; `done` decides what counts as confirmed. */
  const confirm = async (done: () => boolean, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await wait(500)
      if (done()) return true
    }
    return false
  }

  const afterSubmit = async (snap: Snapshot): Promise<void> => {
    savePending(snap)
    // "Responded" that was already on the page proves nothing; the form must be gone too.
    const ok = await confirm(
      () => respondedNow() && (!snap.respondedBefore || document.querySelector(SUBMIT_SELECTOR) === null),
      20_000
    )
    if (takePending() === null || !ok) return
    await record(snap)
  }

  const afterLetter = async (snap: Snapshot): Promise<void> => {
    const ok = await confirm(() => document.querySelector(LETTER_SUBMIT_SELECTOR) === null, 12_000)
    if (ok) await record(snap)
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target === null) return
      rememberSerpVacancy(target)
      const externalId = vacancyExternalId()
      if (externalId === null) return
      if (target.closest(SUBMIT_SELECTOR) !== null) {
        void afterSubmit(snapshot("submit", externalId))
      } else if (target.closest(LETTER_SUBMIT_SELECTOR) !== null) {
        void afterLetter(snapshot("letter", externalId))
      } else if (target.closest(QUICK_RESPONSE_SELECTOR) !== null) {
        const snap = snapshot("submit", externalId)
        // Only a page that showed no response before can prove the quick response.
        if (!snap.respondedBefore) void afterSubmit(snap)
      }
    },
    true
  )

  // A submit that navigated away is confirmed on the page hh opened next.
  const pending = takePending()
  if (pending !== null) {
    void (async () => {
      savePending(pending)
      const ok = await confirm(respondedNow, 15_000)
      if (takePending() !== null && ok) await record(pending)
    })()
  }

  /**
   * On a vacancy page with a draft of this page's account, opens hh's response
   * form once per tab. It goes to the address hh's "Откликнуться" link points
   * at instead of clicking it: the click responds at once on a vacancy without
   * a form, the address only shows the form (the harness reads forms by it).
   */
  const maybeOpen = async (settings: Settings): Promise<void> => {
    if (!settings.autoOpenResponse) return
    const externalId = /^\/vacancy\/(\d+)/.exec(location.pathname)?.[1]
    if (externalId === undefined) return
    if (document.querySelector(QUICK_RESPONSE_SELECTOR) === null || document.querySelector(SUBMIT_SELECTOR) !== null) return
    if (respondedNow()) return
    try {
      if (sessionStorage.getItem(OPENED_KEY + externalId) !== null) return
    } catch {
      return
    }
    const { hhAccountId, drafts } = await draftsFor(externalId)
    // Without knowing the page's account a draft may be another account's.
    if (hhAccountId === null || !drafts.some(sendable)) return
    try {
      sessionStorage.setItem(OPENED_KEY + externalId, String(Date.now()))
    } catch {
      return
    }
    location.assign(`/applicant/vacancy_response?vacancyId=${externalId}`)
  }

  /**
   * Whatever hh's button or popup looked like, a vacancy page that offered a
   * response and now says "you responded" got one: record it. Armed only by a
   * page that showed the button unanswered, so a page that was already
   * "responded" when it loaded (or loaded late) records nothing. The click
   * handlers above usually get there first; the server answers "already".
   */
  const armed = new Set<string>()
  const watchResponded = (): void => {
    const externalId = vacancyExternalId()
    if (externalId === null || !location.pathname.startsWith("/vacancy/")) return
    const responded = respondedNow()
    if (!responded) {
      if (document.querySelector(QUICK_RESPONSE_SELECTOR) !== null) armed.add(externalId)
      return
    }
    if (!armed.delete(externalId)) return
    void record(snapshot("submit", externalId))
  }

  return {
    check: () => {
      void autofill()
      watchResponded()
    },
    maybeOpen
  }
}
