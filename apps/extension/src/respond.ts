import type {
  BrowserDraft,
  BrowserDrafts,
  BrowserSubmitResult,
  FormAnswer,
  FormQuestion,
  ResponseForm
} from "@otbor/contract"
import { parseResponseForm } from "@otbor/hh"
import type { Request } from "@/messages.ts"

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
const LETTER_TOGGLE_SELECTOR = '[data-qa="vacancy-response-letter-toggle"]'
const SUBMIT_SELECTOR = '[data-qa="vacancy-response-submit-popup"]'
/** "Отправить" of the letter dialog of a response hh already holds. */
const LETTER_SUBMIT_SELECTOR = '[data-qa="vacancy-response-letter-submit"]'
const SUCCESS_SELECTOR = '[data-qa="responded-success-attach-cover-letter"]'
const RESUME_SELECTED_SELECTOR = '[data-qa="resume-title"]'
/** The one-click "Откликнуться" on a vacancy page: without a form hh responds at once. */
const QUICK_RESPONSE_SELECTOR =
  '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]'
const TASK_SELECTOR = '[data-qa="task-body"]'
/** Words that name a letter field when its data-qa does not. */
const LETTER_HINT_RE = /letter|cover|сопровод|письм/i

const FILLED = "otborFilled"
const PENDING_KEY = "otbor:pending-submit"
/** A submit that reloaded the page is still checked on the next page this long. */
const PENDING_TTL_MS = 90_000

type Send = <T>(request: Request) => Promise<T>
type Field = HTMLTextAreaElement | HTMLElement

/* -------------------------------------------------------------------------- */
/* Page reading                                                               */
/* -------------------------------------------------------------------------- */

const vacancyExternalId = (): string | null => {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get("vacancyId") ?? /^\/vacancy\/(\d+)/.exec(url.pathname)?.[1] ?? null
  if (fromUrl !== null && /^\d+$/.test(fromUrl)) return fromUrl
  const input = document.querySelector<HTMLInputElement>('input[name="vacancyId"], input[name="vacancy_id"]')
  return input?.value && /^\d+$/.test(input.value) ? input.value : null
}

const norm = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim().toLowerCase()

const selectedResumeTitle = (): string | null => {
  const text = document.querySelector<HTMLElement>(RESUME_SELECTED_SELECTOR)?.innerText?.replace(/\s+/g, " ").trim()
  return text === undefined || text === "" ? null : text
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

/**
 * The draft for the form on screen: the one of the resume the form has
 * selected, else the only one there is.
 */
const pickDraft = (
  drafts: ReadonlyArray<BrowserDraft>,
  usable: (draft: BrowserDraft) => boolean
): { readonly draft: BrowserDraft; readonly matched: boolean } | null => {
  const candidates = drafts.filter(usable)
  const title = norm(selectedResumeTitle())
  if (title !== "") {
    const same = candidates.find((draft) => norm(draft.resumeTitle) === title)
    if (same !== undefined) return { draft: same, matched: true }
  }
  if (candidates.length === 1) return { draft: candidates[0]!, matched: title === "" }
  return null
}

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
  readonly resumeTitle: string | null
  readonly letter: string | null
  readonly answers: ReadonlyArray<FormAnswer>
  readonly formHash: string | null
  readonly respondedBefore: boolean
  readonly at: number
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const startResponseWatch = (send: Send): { readonly check: () => void } => {
  const cache = new Map<string, { readonly at: number; readonly value: Promise<BrowserDrafts> }>()

  const draftsFor = (externalId: string): Promise<BrowserDrafts> => {
    const hit = cache.get(externalId)
    if (hit !== undefined && Date.now() - hit.at < 30_000) return hit.value
    const value = send<BrowserDrafts>({ type: "drafts", externalId })
    cache.set(externalId, { at: Date.now(), value })
    value.catch(() => cache.delete(externalId))
    return value
  }

  /** The draft pasted into the form of a vacancy, to tell its answers from the operator's. */
  const pasted = new Map<string, BrowserDraft>()
  let busy = false

  /** Test answers, once per response form (the submit button carries the mark). */
  const fillAnswers = async (externalId: string): Promise<string | null> => {
    const anchor = document.querySelector<HTMLElement>(SUBMIT_SELECTOR)
    if (anchor === null || anchor.dataset[FILLED] !== undefined) return null
    if (document.querySelector(TASK_SELECTOR) === null) return null
    anchor.dataset[FILLED] = "pending"
    try {
      const { drafts } = await draftsFor(externalId)
      const picked = pickDraft(drafts, (draft) => draft.state !== "submitted" && draft.answers.length > 0)
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
    const picked = pickDraft(drafts, (draft) => letterOf(draft, responded) !== null)
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
      const answers = await fillAnswers(externalId)
      const letter = await fillLetters(externalId)
      const parts = [answers, letter === null ? null : "письмо"].filter((part): part is string => part !== null)
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
      resumeTitle: selectedResumeTitle(),
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

  const record = async (snap: Snapshot): Promise<void> => {
    try {
      const result = await send<BrowserSubmitResult>({
        type: "record",
        payload: {
          kind: snap.kind,
          externalId: snap.externalId,
          resumeTitle: snap.resumeTitle,
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

  return { check: () => void autofill() }
}
