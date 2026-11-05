import type { CoverLetterRequirement, FormOption, FormQuestion, ResponseForm } from "@otbor/contract"
import { initialStatePayload } from "./extract.ts"
import { decodeEntities, htmlToText } from "./text.ts"

/**
 * Parser for the hh.ru response form ("employer test").
 *
 * The test is not an exam: it is the form behind
 * `/applicant/vacancy_response?vacancyId=...`. Selectors, verified on a live
 * page on 2026-10-28:
 *
 * - form `#RESPONSE_MODAL_FORM_ID`;
 * - question `[data-qa="task-body"]`, text `[data-qa="task-question"]`;
 * - options `input[type=radio|checkbox][name="task_<id>"]`, `value` is the
 *   option id;
 * - free text `textarea[name="task_<id>_text"]`;
 * - `HH-Lux-InitialState` carries no questions, so the markup is the only source.
 *
 * Pure string scanning: no DOM, no browser globals. When the markup is not
 * recognized the result is `layout: "unknown"` with no questions, never a
 * silent "this form has no questions".
 */

/* -------------------------------------------------------------------------- */
/* Small HTML helpers                                                         */
/* -------------------------------------------------------------------------- */

type Attrs = Readonly<Record<string, string>>

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

const attrsOf = (tag: string): Attrs => {
  const out: Record<string, string> = {}
  const inner = tag.replace(/^<[^\s>/]+/, "").replace(/\/?>$/, "")
  for (const match of inner.matchAll(ATTR_RE)) {
    const name = match[1]?.toLowerCase()
    if (name === undefined) continue
    out[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")
  }
  return out
}

const collapse = (input: string): string => input.replace(/\s+/g, " ").trim()

const textOf = (html: string): string => collapse(htmlToText(html).replace(/^[•\s]+/, ""))

/** Case, ё and whitespace folding used only for hashing. */
const fold = (input: string): string =>
  collapse(input.normalize("NFKC").toLowerCase().replace(/ё/g, "е"))

/** 64-bit FNV-1a over UTF-16 code units. Deterministic everywhere. */
export const stableHash = (input: string): string => {
  const mask = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & mask
  }
  return hash.toString(16).padStart(16, "0")
}

/* -------------------------------------------------------------------------- */
/* Vacancy id                                                                 */
/* -------------------------------------------------------------------------- */

const vacancyIdFromUrl = (url: string): string | null =>
  url.match(/[?&]vacancyId=(\d+)/)?.[1] ?? url.match(/\/vacancy\/(\d+)/)?.[1] ?? null

const vacancyIdFromForm = (html: string): string | null => {
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const attrs = attrsOf(tag)
    if ((attrs.name === "vacancyId" || attrs.name === "vacancy_id") && attrs.value) {
      return attrs.value
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Question blocks                                                            */
/* -------------------------------------------------------------------------- */

const TASK_BODY_RE = /<[a-z][^>]*\bdata-qa=["']task-body["'][^>]*>/gi
const SUBMIT_RE = /data-qa=["']vacancy-response-submit-popup["']/i
const LETTER_RE = /letter/i

/** Each block runs to the next task, the form end or the submit button. */
const taskBlocks = (html: string): ReadonlyArray<string> => {
  const starts = [...html.matchAll(TASK_BODY_RE)].map((match) => match.index ?? 0)
  return starts.map((start, index) => {
    let end = starts[index + 1] ?? html.length
    const tail = html.slice(start, end)
    const stops = [tail.search(/<\/form\s*>/i), tail.search(SUBMIT_RE)].filter((at) => at > 0)
    if (stops.length > 0) end = start + Math.min(...stops)
    return html.slice(start, end)
  })
}

const questionText = (block: string): string | null => {
  const match = block.match(/<(\w+)\b[^>]*\bdata-qa=["']task-question["'][^>]*>([\s\S]*?)<\/\1>/i)
  if (match === null) return null
  const text = textOf(match[2] ?? "")
  return text === "" ? null : text
}

interface Label {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly forId: string | null
}

const labelsOf = (block: string): ReadonlyArray<Label> =>
  [...block.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)].map((match) => {
    const start = match.index ?? 0
    return {
      start,
      end: start + match[0].length,
      text: textOf(match[2] ?? ""),
      forId: attrsOf(`<label ${match[1] ?? ""}>`).for ?? null
    }
  })

const MAX_OPTIONS = 64

interface Control {
  readonly index: number
  readonly attrs: Attrs
}

const controlsOf = (block: string, pattern: RegExp): ReadonlyArray<Control> =>
  block
    .matchAll(pattern)
    .map((match) => ({ index: match.index ?? 0, attrs: attrsOf(match[0]) }))
    .filter(
      (control) =>
        control.attrs.disabled === undefined &&
        control.attrs.type !== "hidden" &&
        !LETTER_RE.test(control.attrs.name ?? "")
    )
    .toArray()

const taskIdOf = (name: string | undefined): string | null =>
  name?.match(/^task_(\d+)(?:_text)?$/)?.[1] ?? null

const CODE_TASK_RE =
  /(?:реализуй|напиши|написать|разработай|допиши|исправь)[а-яa-z]*[^.?!]{0,60}(?:функци|метод|класс|скрипт|sql|запрос[а-яa-z]*\s+к\s+(?:бд|базе)|программ|алгоритм|код)|(?:implement|write)\s+(?:a|an|the)?\s*(?:function|method|class|query|program|algorithm)|leetcode/i

const CODE_LANGUAGE_RE =
  /\b(python|javascript|typescript|java|golang|go|c\+\+|c#|rust|php|ruby|kotlin|swift|sql|bash|shell)\b/i

const codeLanguage = (block: string, text: string): string | null => {
  const fromAttr = block.match(/\bdata-language=["']([^"']+)["']/i)?.[1]
  if (fromAttr) return fromAttr.trim().toLowerCase()
  return text.match(CODE_LANGUAGE_RE)?.[1]?.toLowerCase() ?? null
}

const parseQuestion = (
  block: string,
  ordinal: number,
  allRequired: boolean
): FormQuestion | null => {
  const rawText = questionText(block)
  if (rawText === null) return null
  const text = collapse(rawText.replace(/\s*\*\s*$/, ""))

  const labels = labelsOf(block)
  const radios = controlsOf(block, /<input\b[^>]*\btype=["']?radio["']?[^>]*>/gi)
  const checkboxes = controlsOf(block, /<input\b[^>]*\btype=["']?checkbox["']?[^>]*>/gi)
  const textareas = controlsOf(block, /<textarea\b[^>]*>/gi)
  const selects = [...block.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
  const editable = /\bcontenteditable=["']?true/i.test(block)

  const required =
    allRequired ||
    /\*\s*$/.test(rawText) ||
    /data-qa=["'][^"']*required/i.test(block) ||
    [...radios, ...checkboxes, ...textareas].some(
      (control) => control.attrs.required !== undefined || control.attrs["aria-required"] === "true"
    )

  const choice = radios.length > 0 ? radios : checkboxes
  if (choice.length > 0) {
    const seen = new Set<string>()
    const options: Array<FormOption> = []
    for (const control of choice) {
      const id = control.attrs.value
      if (id === undefined || id === "" || seen.has(id)) continue
      seen.add(id)
      const wrapping = labels.find((label) => label.start < control.index && control.index < label.end)
      const byFor = control.attrs.id
        ? labels.find((label) => label.forId === control.attrs.id)
        : undefined
      const label = wrapping?.text || byFor?.text || collapse(control.attrs["aria-label"] ?? "") || id
      options.push({ id, label })
      if (options.length >= MAX_OPTIONS) break
    }
    if (options.length === 0) return null
    return {
      id: taskIdOf(choice[0]?.attrs.name) ?? `q${ordinal}`,
      kind: radios.length > 0 ? "single" : "multiple",
      text,
      options,
      required,
      maxLength: null,
      codeLanguage: null
    }
  }

  const select = selects[0]
  if (select !== undefined) {
    const attrs = attrsOf(`<select ${select[1] ?? ""}>`)
    const options: Array<FormOption> = []
    for (const option of (select[2] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const optionAttrs = attrsOf(`<option ${option[1] ?? ""}>`)
      const label = textOf(option[2] ?? "")
      const id = optionAttrs.value ?? label
      if (id === "" || optionAttrs.disabled !== undefined) continue
      options.push({ id, label: label || id })
      if (options.length >= MAX_OPTIONS) break
    }
    if (options.length === 0) return null
    return {
      id: taskIdOf(attrs.name) ?? `q${ordinal}`,
      kind: "single",
      text,
      options,
      required,
      maxLength: null,
      codeLanguage: null
    }
  }

  const area = textareas[0]
  if (area !== undefined || editable) {
    const code =
      editable ||
      /data-qa=["'][^"']*code-editor/i.test(block) ||
      /\bdata-language=/i.test(block) ||
      /\b(?:CodeMirror|monaco)/i.test(block) ||
      CODE_TASK_RE.test(text)
    const limit = Number.parseInt(area?.attrs.maxlength ?? "", 10)
    return {
      id: taskIdOf(area?.attrs.name) ?? `q${ordinal}`,
      kind: code ? "code" : "text",
      text,
      options: [],
      required,
      maxLength: Number.isFinite(limit) && limit > 0 ? limit : null,
      codeLanguage: code ? codeLanguage(block, text) : null
    }
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* Cover letter and form hash                                                 */
/* -------------------------------------------------------------------------- */

const coverLetterOf = (html: string): CoverLetterRequirement => {
  const field = [...html.matchAll(/<textarea\b[^>]*>/gi)]
    .map((match) => attrsOf(match[0]))
    .find((attrs) => LETTER_RE.test(`${attrs.name ?? ""} ${attrs["data-qa"] ?? ""}`))
  if (field !== undefined) {
    return field.required !== undefined || /required/i.test(field["data-qa"] ?? "")
      ? "required"
      : "optional"
  }
  if (/data-qa=["']vacancy-response-letter-required["']/i.test(html)) return "required"
  if (/data-qa=["']vacancy-response-letter-toggle["']/i.test(html)) return "optional"
  return "absent"
}

/**
 * Stable over the normalized text of questions and options, in page order.
 * Option ids are included because they are per-form; `required` and
 * `maxLength` are not, so cosmetic markup changes do not invalidate a kit.
 */
export const formHashOf = (questions: ReadonlyArray<FormQuestion>): string =>
  stableHash(
    JSON.stringify(
      questions.map((question) => [
        question.id,
        question.kind,
        fold(question.text),
        question.options.map((option) => [option.id, fold(option.label)])
      ])
    )
  )

const hasResponseForm = (html: string): boolean =>
  /id=["']RESPONSE_MODAL_FORM_ID["']|name=["']vacancy_response["']|data-qa=["']vacancy-response-submit-popup["']/i.test(
    html
  )

const declaresRequiredTest = (html: string): boolean =>
  (html.match(/<input\b[^>]*>/gi) ?? []).some((tag) => {
    const attrs = attrsOf(tag)
    return attrs.name === "testRequired" && attrs.value === "true"
  })

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parses the response form page. Never fails: an unrecognized or partly
 * unreadable page is reported as `layout: "unknown"` with no questions.
 *
 * Questions are `required` when the markup says so, and also when the form
 * carries `testRequired=true`: hh keeps submit disabled until every task has
 * an answer.
 */
export const parseResponseForm = (html: string, url: string): ResponseForm => {
  const vacancyId = vacancyIdFromUrl(url) ?? vacancyIdFromForm(html) ?? ""
  const coverLetter = coverLetterOf(html)
  const testRequired = declaresRequiredTest(html)

  const unknown = (): ResponseForm => ({
    vacancyId,
    layout: "unknown",
    questions: [],
    coverLetter,
    formHash: stableHash(JSON.stringify(["unknown", vacancyId]))
  })

  const blocks = taskBlocks(html)
  if (blocks.length === 0) {
    // A form that declares a test but has no readable tasks is a layout
    // change, not an empty questionnaire. So is a page with no form at all.
    if (!hasResponseForm(html) || testRequired) return unknown()
    return { vacancyId, layout: "known", questions: [], coverLetter, formHash: formHashOf([]) }
  }

  const questions: Array<FormQuestion> = []
  for (const block of blocks) {
    const question = parseQuestion(block, questions.length, testRequired)
    // One unreadable task makes the whole form untrustworthy.
    if (question === null) return unknown()
    questions.push(question)
  }
  return { vacancyId, layout: "known", questions, coverLetter, formHash: formHashOf(questions) }
}

/* -------------------------------------------------------------------------- */
/* Test flag on the vacancy page                                              */
/* -------------------------------------------------------------------------- */

export interface VacancyTestStatus {
  readonly hasTest: boolean
  /** null when hh does not say whether the test is mandatory. */
  readonly required: boolean | null
  readonly testId: string | null
}

const NO_TEST: VacancyTestStatus = { hasTest: false, required: null, testId: null }

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const positiveId = (value: unknown): string | null => {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? String(number) : null
}

/**
 * Reads whether the vacancy has an employer test from
 * `applicantVacancyResponseStatuses[<vacancyId>]` in the initial state.
 * Kept apart from `extractVacancy` because `VacancyDraft` has no field for it
 * yet (adding one is a contract change). A page without a response status
 * yields "no test"; `required: null` means hh did not say.
 */
export const readVacancyTest = (html: string, externalId: string): VacancyTestStatus => {
  const payload = initialStatePayload(html)
  if (payload === null) return NO_TEST
  let state: unknown
  try {
    state = JSON.parse(payload.trim())
  } catch {
    try {
      state = JSON.parse(decodeEntities(payload.trim()))
    } catch {
      return NO_TEST
    }
  }
  const status = record(record(record(state)?.applicantVacancyResponseStatuses)?.[externalId])
  if (status === null) return NO_TEST
  const test = record(status.test)
  const short = record(status.shortVacancy)
  const testId = positiveId(test?.testId) ?? positiveId(short?.userTestId)
  const hasTest = test?.hasTests === true || short?.userTestPresent === true || testId !== null
  if (!hasTest) return NO_TEST
  return {
    hasTest: true,
    required: typeof test?.required === "boolean" ? test.required : null,
    testId
  }
}
