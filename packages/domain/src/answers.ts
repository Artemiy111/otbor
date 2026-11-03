import type { FormAnswer, FormQuestion, ResponseForm } from "@otbor/contract"

/**
 * Deterministic hints and validation for the hh.ru response form.
 *
 * Hints are input to the model, not final answers. A `hard` hint is a business
 * rule the model may not rewrite (remote is always "yes", the salary follows
 * the table below); a soft hint is context it may rephrase. Everything here is
 * pure: the same code runs in the cloud and in the harness.
 */

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

const norm = (input: string): string =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const has = (text: string, pattern: RegExp): boolean => pattern.test(text)

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

export type QuestionClass =
  | "salary"
  | "remote"
  | "office"
  | "relocation"
  | "city"
  | "tool_experience"
  | "english"
  | "start_date"
  | "other"

const SALARY_RE =
  /заработн|зарплат|(?<![а-я])зп(?![а-я])|доход|оплат[а-яa-z]*\s+труда|вилк|от каких сумм|какие суммы|сумм[а-яa-z]*.{0,30}рассматрива|salary|compensation|expected pay|pay expectation|desired (?:pay|income)/
const PAST_SALARY_RE =
  /(?:предыдущ|прошл|последн|текущ|нынешн|на\s+(?:вашем\s+)?(?:прежн|текущ))[а-яa-z]*.{0,40}(?:зарплат|заработн|доход|оклад)|(?:зарплат|заработн|доход|оклад)[а-яa-z]*.{0,40}(?:предыдущ|прошл|прежн|последн)[а-яa-z]*\s+(?:месте|работе|компании)|(?:previous|current|last|present)\s+(?:salary|pay|compensation)/
const RELOCATION_RE = /переезд|релокац|переех|relocat|move to another city/
const OFFICE_RE = /офис|гибрид|hybrid|\boffice\b|on-?site/
const REMOTE_RE = /удален|дистанц|\bremote\b|work from home|из дома/
const CITY_RE =
  /в каком город|город[а-яa-z]*\s+(?:проживани|пребывани)|где (?:вы )?(?:сейчас )?(?:прожива|жив)|место жительства|прожива[а-яa-z]*|ваш город|(?<![а-я])ваш[а-яa-z]* город|city of residence|where do you (?:live|reside)|which city|what city/
const ENGLISH_RE = /английск|\benglish\b|уровень\s+языка/
const START_RE =
  /приступить|выйти на работу|выйдете на работу|срок[а-яa-z]*\s+выхода|готов[а-яa-z]*\s+выйти|когда\s+(?:вы\s+)?(?:сможете|готовы)\s+(?:выйти|начать|приступить)|уведомлен|start date|notice period|when can you start/
const TOOL_YES_NO_RE =
  /(?:^|[\s,.;:])(?:использова[а-яa-z]*|работал[а-яa-z]*|применял[а-яa-z]*|пользовал[а-яa-z]*|сталкивал[а-яa-z]*)\s+(?:ли\s+)?(?:вы\s+)?(?:с\s+|в\s+)?\S|(?<![а-я])вы\s+(?:использова|работал|применял|пользовал|знакомы)|have you (?:ever )?(?:used|worked with|tried)|are you familiar with|do you (?:use|know)\b/
const TOOL_NOT_RE = /сколько|как долго|как давно|лет\b|how (?:many|long)|years/

/**
 * Buckets a question by normalized text, Russian and English. Order matters:
 * more specific topics win, and a question that mixes remote and office
 * wording is treated as an office/hybrid question (the preference is the
 * point), while the bare "can you work remotely" is the remote rule.
 */
export const classifyQuestion = (question: Pick<FormQuestion, "text">): QuestionClass => {
  const text = norm(question.text)
  if (has(text, SALARY_RE) && !has(text, PAST_SALARY_RE)) return "salary"
  if (has(text, RELOCATION_RE)) return "relocation"
  if (has(text, OFFICE_RE)) return "office"
  if (has(text, REMOTE_RE)) return "remote"
  if (has(text, CITY_RE)) return "city"
  if (has(text, ENGLISH_RE)) return "english"
  if (has(text, START_RE)) return "start_date"
  if (has(text, TOOL_YES_NO_RE) && !has(text, TOOL_NOT_RE)) return "tool_experience"
  return "other"
}

/** The salary check used by validation: the answer must carry a number. */
export const isSalaryQuestion = (question: Pick<FormQuestion, "text">): boolean =>
  classifyQuestion(question) === "salary"

/* -------------------------------------------------------------------------- */
/* Salary                                                                     */
/* -------------------------------------------------------------------------- */

export interface SalaryExpectationInput {
  /** What the candidate wants (resume enrichment `salaryExpectation`). */
  readonly expectation: number | null
  /** The floor (resume enrichment `salaryMin`). */
  readonly minimum: number | null
  readonly currency: string | null
}

export interface VacancySalaryInput {
  readonly from: number | null
  readonly to: number | null
  readonly currency: string | null
}

export type SalaryBlocker = "upper_bound_below_minimum" | "currency_mismatch"

export interface SalaryAnswer {
  /** "N" or "от N", digits grouped by spaces, no currency sign. */
  readonly text: string
  readonly amount: number
  readonly currency: string
  readonly source: "expectation" | "vacancy" | "both"
  readonly blockers: ReadonlyArray<SalaryBlocker>
  readonly note: string | null
}

/** hh says `RUR`, the profile says `RUB`: the same currency. */
const currencyCode = (value: string | null | undefined): string => {
  const code = (value ?? "").trim().toUpperCase()
  return code === "" || code === "RUR" ? "RUB" : code
}

const groupDigits = (amount: number): string =>
  String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const salaryText = (amount: number, lowerBound: boolean): string =>
  `${lowerBound ? "от " : ""}${groupDigits(amount)}`

/**
 * The salary table:
 *
 * | vacancy | answer |
 * | --- | --- |
 * | from X to Y | max(expectation, middle of the range), capped at Y |
 * | to Y below the expectation | Y |
 * | from X only | max(expectation, X) as "от N" |
 * | to Y only | Y |
 * | no range | the expectation as "от N" |
 * | upper bound below the minimum | the upper bound, blocker |
 * | currency differs | no conversion: the vacancy figure in its own currency, blocker |
 *
 * Returns null when no number can be named deterministically (no expectation
 * and only a lower bound, or nothing at all): the model then names a market
 * figure and the answer is marked for a human.
 */
export const salaryAnswer = (
  expectation: SalaryExpectationInput | null,
  vacancy: VacancySalaryInput
): SalaryAnswer | null => {
  const from = vacancy.from
  const to = vacancy.to
  const vacancyCurrency = currencyCode(vacancy.currency)
  const hasVacancy = from !== null || to !== null
  const candidate = expectation?.expectation ?? expectation?.minimum ?? null
  const minimum = expectation?.minimum ?? null

  const mismatch =
    expectation !== null &&
    hasVacancy &&
    vacancy.currency !== null &&
    currencyCode(expectation.currency) !== vacancyCurrency

  if (mismatch) {
    // Never convert. Name the vacancy's own figure in the vacancy's currency.
    const middle = from !== null && to !== null ? (from + to) / 2 : null
    const amount = middle ?? to ?? from
    if (amount === null) return null
    return {
      text: salaryText(amount, middle === null && to === null),
      amount: Math.round(amount),
      currency: vacancyCurrency,
      source: "vacancy",
      blockers: ["currency_mismatch"],
      note: `currency differs: expectation in ${currencyCode(expectation.currency)}, vacancy in ${vacancyCurrency}`
    }
  }

  const currency = vacancyCurrency !== "RUB" || vacancy.currency !== null
    ? vacancyCurrency
    : currencyCode(expectation?.currency)

  if (to !== null) {
    if (candidate !== null && to < candidate) {
      const below = minimum !== null && to < minimum
      return {
        text: salaryText(to, false),
        amount: to,
        currency,
        source: "both",
        blockers: below ? ["upper_bound_below_minimum"] : [],
        note: below
          ? `upper bound ${to} is below the minimum ${minimum}`
          : `vacancy is below the expectation: ${to} against ${candidate}`
      }
    }
    if (from !== null && candidate === null) {
      const middle = Math.round((from + to) / 2)
      return { text: salaryText(middle, false), amount: middle, currency, source: "vacancy", blockers: [], note: null }
    }
    if (from !== null && candidate !== null) {
      const middle = (from + to) / 2
      const amount = Math.round(Math.min(Math.max(candidate, middle), to))
      return { text: salaryText(amount, false), amount, currency, source: "both", blockers: [], note: null }
    }
    return { text: salaryText(to, false), amount: to, currency, source: "vacancy", blockers: [], note: null }
  }

  if (from !== null) {
    if (candidate === null) return null
    const amount = Math.max(candidate, from)
    return { text: salaryText(amount, true), amount, currency, source: "both", blockers: [], note: null }
  }

  if (candidate === null) return null
  return {
    text: salaryText(candidate, true),
    amount: candidate,
    currency: currencyCode(expectation?.currency),
    source: "expectation",
    blockers: [],
    note: null
  }
}

/* -------------------------------------------------------------------------- */
/* Hints                                                                      */
/* -------------------------------------------------------------------------- */

export type Readiness = boolean | "negotiable"

/**
 * Candidate facts that are not in the resume record yet. Anything left null or
 * missing produces no hint for that topic; the model answers from the resume
 * and the vacancy and the answer is marked for a human.
 */
export interface ProfileFacts {
  readonly city?: string | null
  readonly relocation?: Readiness | null
  /** Overrides the resume `workFormats` for the office question. */
  readonly office?: Readiness | null
  /** Overrides the resume `workFormats` for the hybrid question. */
  readonly hybrid?: Readiness | null
  readonly english?: string | null
  readonly startDate?: string | null
}

export interface HintVacancy {
  readonly areaName: string | null
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly workFormats: ReadonlyArray<string>
}

export interface HintInput {
  readonly questions: ReadonlyArray<FormQuestion>
  readonly vacancy: HintVacancy
  /** From resume enrichment, falling back to the resume `salaryAmount`. */
  readonly salary: SalaryExpectationInput | null
  /** Work formats of the resume: "remote" | "hybrid" | "office". */
  readonly resumeWorkFormats: ReadonlyArray<string>
  readonly profile?: ProfileFacts
}

export interface AnswerHint {
  readonly questionId: string
  readonly kind: QuestionClass
  readonly optionIds?: ReadonlyArray<string>
  readonly text?: string
  readonly hard: boolean
  readonly confidence: number
  readonly note: string | null
  readonly evidence: ReadonlyArray<string>
  readonly blockers: ReadonlyArray<string>
}

const isChoice = (question: FormQuestion): boolean =>
  question.kind === "single" || question.kind === "multiple"

const findOption = (
  question: FormQuestion,
  predicate: (label: string) => boolean
): string | null => question.options.find((option) => predicate(norm(option.label)))?.id ?? null

const YES_RE = /^(?:да|yes)(?![а-яa-z])/
const NO_RE = /^(?:нет|no)(?![а-яa-z])/

/** A yes/no hint in the shape of the question, or null when no option fits. */
const yesNo = (
  question: FormQuestion,
  answer: Readiness,
  base: Omit<AnswerHint, "questionId" | "optionIds" | "text">
): AnswerHint | null => {
  if (!isChoice(question)) {
    const text = answer === "negotiable" ? "Обсуждаемо" : answer ? "Да" : "Нет"
    return { questionId: question.id, text, ...base }
  }
  const id =
    answer === "negotiable"
      ? findOption(question, (label) => /обсуд|возможн|зависит|negotiab/.test(label))
      : answer
        ? (findOption(question, (label) => label === "да" || label === "yes") ??
          findOption(question, (label) => YES_RE.test(label)))
        : (findOption(question, (label) => label === "нет" || label === "no") ??
          findOption(question, (label) => NO_RE.test(label)))
  return id === null ? null : { questionId: question.id, optionIds: [id], ...base }
}

const ready = (formats: ReadonlyArray<string>, format: string): boolean | null =>
  formats.length === 0 ? null : formats.map(norm).includes(format)

const officeHint = (
  question: FormQuestion,
  office: Readiness | null,
  hybrid: Readiness | null,
  evidence: ReadonlyArray<string>
): AnswerHint | null => {
  if (office === null && hybrid === null) return null
  const base = { kind: "office" as const, hard: true, confidence: 0.8, note: null, evidence, blockers: [] }
  if (office === "negotiable" || hybrid === "negotiable") {
    return yesNo(question, "negotiable", { ...base, confidence: 0.6 })
  }
  const officeYes = office === true
  const hybridYes = hybrid === true
  if (!isChoice(question)) {
    const text =
      officeYes && hybridYes
        ? "Да, офисный и гибридный"
        : officeYes
          ? "Да, офисный"
          : hybridYes
            ? "Да, гибридный"
            : "Нет, только удалённо"
    return { questionId: question.id, text, ...base }
  }
  const id =
    officeYes && hybridYes
      ? (findOption(question, (label) => /офис/.test(label) && /гибрид/.test(label)) ??
        findOption(question, (label) => /офис/.test(label)))
      : officeYes
        ? findOption(question, (label) => /офис/.test(label) && !/гибрид/.test(label))
        : hybridYes
          ? findOption(question, (label) => /гибрид/.test(label) && !/офис/.test(label))
          : findOption(question, (label) => /удал|нет|only remote|remote only/.test(label))
  return id === null ? null : { questionId: question.id, optionIds: [id], ...base }
}

/** A free-form fact as a hint: an option whose label contains it, else text. */
const factHint = (
  question: FormQuestion,
  kind: QuestionClass,
  value: string,
  base: { hard: boolean; confidence: number; evidence: ReadonlyArray<string> }
): AnswerHint => {
  const common = { kind, note: null, blockers: [] as ReadonlyArray<string>, ...base }
  if (isChoice(question)) {
    const wanted = norm(value)
    const id =
      findOption(question, (label) => label === wanted) ??
      findOption(question, (label) => label.includes(wanted))
    if (id !== null) return { questionId: question.id, optionIds: [id], ...common }
  }
  return { questionId: question.id, text: value, ...common }
}

const sameCity = (a: string, b: string): boolean => norm(a) === norm(b)

/**
 * One hint per question where a deterministic answer exists, in form order.
 *
 * - remote: always "yes", hard;
 * - salary: the table in `salaryAnswer`, hard for text questions only;
 * - office / hybrid: from the resume work formats or the profile override, hard;
 * - relocation: only from the profile override (the resume record has no
 *   relocation field), hard;
 * - city: when the vacancy is office or hybrid and in a different city than
 *   the candidate's, the vacancy city (hard); otherwise the candidate's city
 *   (soft). Needs `profile.city`;
 * - "have you used X?": always "Да". This is a prompt rule from the previous
 *   project, not a claim about experience, so it is soft: the model may
 *   rephrase it but it is not a protected fact;
 * - english / start date: soft, from the profile.
 */
export const answerHints = (input: HintInput): ReadonlyArray<AnswerHint> => {
  const profile = input.profile ?? {}
  const vacancyFormats = input.vacancy.workFormats.map(norm)
  const vacancyOnsite = vacancyFormats.includes("office") || vacancyFormats.includes("hybrid")
  const vacancyRemote = vacancyFormats.includes("remote")
  const office = profile.office ?? ready(input.resumeWorkFormats, "office")
  const hybrid = profile.hybrid ?? ready(input.resumeWorkFormats, "hybrid")
  const salary = salaryAnswer(input.salary, {
    from: input.vacancy.salaryFrom,
    to: input.vacancy.salaryTo,
    currency: input.vacancy.salaryCurrency
  })

  const hints: Array<AnswerHint> = []
  for (const question of input.questions) {
    if (question.kind === "code") continue
    const kind = classifyQuestion(question)
    switch (kind) {
      case "salary": {
        if (salary === null) break
        hints.push({
          questionId: question.id,
          kind,
          text: salary.text,
          hard: question.kind === "text",
          confidence: salary.blockers.length > 0 ? 0.2 : 0.8,
          note: salary.note,
          evidence: [`salary: ${salary.text}`],
          blockers: salary.blockers
        })
        break
      }
      case "remote": {
        const hint = yesNo(question, true, {
          kind,
          hard: true,
          confidence: 0.95,
          note: null,
          evidence: ["remote work is always acceptable"],
          blockers: []
        })
        if (hint !== null) hints.push(hint)
        break
      }
      case "office": {
        const hint = officeHint(question, office, hybrid, [
          `resume formats: ${input.resumeWorkFormats.join(", ") || "none"}`
        ])
        if (hint !== null) hints.push(hint)
        break
      }
      case "relocation": {
        if (profile.relocation === undefined || profile.relocation === null) break
        const hint = yesNo(question, profile.relocation, {
          kind,
          hard: true,
          confidence: 0.8,
          note: null,
          evidence: ["profile: relocation"],
          blockers: []
        })
        if (hint !== null) hints.push(hint)
        break
      }
      case "city": {
        const own = profile.city?.trim() || null
        const theirs = input.vacancy.areaName?.trim() || null
        if (own === null) break
        if (theirs !== null && vacancyOnsite && !vacancyRemote && !sameCity(own, theirs)) {
          hints.push({
            ...factHint(question, kind, theirs, {
              hard: true,
              confidence: 0.8,
              evidence: [`vacancy city ${theirs}, resume city ${own}, on-site format`]
            }),
            note: "the employer is looking for someone in the vacancy city"
          })
        } else {
          hints.push(factHint(question, kind, own, { hard: false, confidence: 0.8, evidence: [own] }))
        }
        break
      }
      case "tool_experience": {
        // Soft on purpose: a prompt rule from the previous project ("always
        // yes"), not a statement the form protects.
        const hint = yesNo(question, true, {
          kind,
          hard: false,
          confidence: 0.7,
          note: "tool-usage questions are answered yes by rule",
          evidence: [],
          blockers: []
        })
        if (hint !== null) hints.push(hint)
        break
      }
      case "english": {
        const value = profile.english?.trim()
        if (value) hints.push(factHint(question, kind, value, { hard: false, confidence: 0.9, evidence: [value] }))
        break
      }
      case "start_date": {
        const value = profile.startDate?.trim()
        if (value) hints.push(factHint(question, kind, value, { hard: false, confidence: 0.9, evidence: [value] }))
        break
      }
      case "other":
        break
    }
  }
  return hints
}

/* -------------------------------------------------------------------------- */
/* Style                                                                      */
/* -------------------------------------------------------------------------- */

export type StyleViolationCode = "dash" | "emoji" | "exclamation"

export interface StyleViolation {
  readonly code: StyleViolationCode
  readonly index: number
  readonly value: string
}

/** Long dashes: hyphen variants, figure, en, em, horizontal bar, minus. A plain "-" is allowed. */
const LONG_DASH = /[‐-―−]/gu
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu

/** House style for text sent to employers: no long dashes, emoji or "!". */
export const checkTextStyle = (text: string): ReadonlyArray<StyleViolation> => {
  const found: Array<StyleViolation> = []
  for (const match of text.matchAll(LONG_DASH)) {
    found.push({ code: "dash", index: match.index ?? 0, value: match[0] })
  }
  for (const match of text.matchAll(EMOJI)) {
    found.push({ code: "emoji", index: match.index ?? 0, value: match[0] })
  }
  for (let index = text.indexOf("!"); index !== -1; index = text.indexOf("!", index + 1)) {
    found.push({ code: "exclamation", index, value: "!" })
  }
  return found.sort((a, b) => a.index - b.index)
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type AnswerErrorCode =
  | "unknown_question"
  | "unknown_option"
  | "too_many_options"
  | "required_unanswered"
  | "hard_hint_overridden"
  | "salary_without_number"
  | "text_too_long"
  | "banned_style"

export interface AnswerError {
  readonly code: AnswerErrorCode
  readonly questionId: string
  readonly message: string
}

const hasContent = (answer: FormAnswer | undefined): boolean =>
  answer !== undefined &&
  ((answer.optionIds?.length ?? 0) > 0 || (answer.text ?? "").trim() !== "")

const sameOptions = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000")

const digitsOf = (text: string): string => text.replace(/\D+/g, "")

const normalizeAnswerText = (text: string): string =>
  norm(text).replace(/[\s.,;:]+$/g, "")

const matchesHint = (answer: FormAnswer, hint: AnswerHint, kind: QuestionClass): boolean => {
  if (hint.optionIds !== undefined) {
    return sameOptions(answer.optionIds ?? [], hint.optionIds)
  }
  const given = answer.text ?? ""
  if (kind === "salary") return digitsOf(given) === digitsOf(hint.text ?? "")
  return normalizeAnswerText(given) === normalizeAnswerText(hint.text ?? "")
}

/**
 * Checks model/human answers against the form and the hints. Returns every
 * problem at once so a repair prompt can list them. An empty array means the
 * answers may be filled; it does not mean they are true.
 *
 * Code answers are exempt from the style rules (`!=` is not an exclamation).
 */
export const validateAnswers = (
  form: Pick<ResponseForm, "questions">,
  answers: ReadonlyArray<FormAnswer>,
  hints: ReadonlyArray<AnswerHint>
): ReadonlyArray<AnswerError> => {
  const errors: Array<AnswerError> = []
  const questions = new Map(form.questions.map((question) => [question.id, question]))
  const byQuestion = new Map<string, FormAnswer>()
  const push = (code: AnswerErrorCode, questionId: string, message: string) => {
    errors.push({ code, questionId, message })
  }

  for (const answer of answers) {
    const question = questions.get(answer.questionId)
    if (question === undefined) {
      push("unknown_question", answer.questionId, "answer for a question that is not on the form")
      continue
    }
    byQuestion.set(answer.questionId, answer)

    const ids = answer.optionIds ?? []
    const known = new Set(question.options.map((option) => option.id))
    for (const id of ids) {
      if (!known.has(id)) push("unknown_option", question.id, `option ${id} is not offered`)
    }
    if (question.kind === "single" && ids.length > 1) {
      push("too_many_options", question.id, "a single-choice question takes one option")
    }

    const text = answer.text ?? ""
    if (question.maxLength != null && text.length > question.maxLength) {
      push("text_too_long", question.id, `${text.length} characters, limit ${question.maxLength}`)
    }
    if (question.kind !== "code") {
      const violations = checkTextStyle(text)
      if (violations.length > 0) {
        const codes = [...new Set(violations.map((violation) => violation.code))]
        push("banned_style", question.id, `banned style: ${codes.join(", ")}`)
      }
    }
    if (isSalaryQuestion(question) && text.trim() !== "" && !/\d/.test(text)) {
      push("salary_without_number", question.id, "a salary answer must contain a number")
    }
  }

  for (const question of form.questions) {
    const answer = byQuestion.get(question.id)
    const filled = hasContent(answer)
    if (question.required && !filled) {
      push("required_unanswered", question.id, "required question has no answer")
    }
    if (
      isSalaryQuestion(question) &&
      answer !== undefined &&
      !filled &&
      !errors.some((error) => error.questionId === question.id && error.code === "required_unanswered")
    ) {
      push("salary_without_number", question.id, "a salary answer must contain a number")
    }
  }

  for (const hint of hints) {
    if (!hint.hard) continue
    const question = questions.get(hint.questionId)
    const answer = byQuestion.get(hint.questionId)
    if (question === undefined || answer === undefined || !hasContent(answer)) continue
    if (!matchesHint(answer, hint, hint.kind)) {
      push("hard_hint_overridden", hint.questionId, `a hard ${hint.kind} hint was changed`)
    }
  }

  return errors
}
