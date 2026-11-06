import type { VacancyAnalysisFacts, VacancyDetail } from "@otbor/contract"
import { ANALYSIS_LEVEL_LABELS, ANALYSIS_ROLE_LABELS } from "./analysis"
import { employmentFormLabel } from "./vacancy-labels"
import { seniorityLabel } from "./status"
import { applicationRequestLabel, redFlagLabel } from "./vacancy-facts"

/**
 * Three independent sources describe one vacancy:
 *  - hh: structured fields of the vacancy page (always unambiguous),
 *  - text: what regular-expression detectors found in the description,
 *  - ai: what the local decision model concluded.
 * `buildRecon` lines them up per parameter so the page can show where they
 * agree and where they do not. Only parameters that matter for THIS vacancy
 * are returned: a parameter every source answers "no" to is dropped.
 */

export type ReconSource = "hh" | "text" | "ai"
export const RECON_SOURCES: ReadonlyArray<{ readonly id: ReconSource; readonly short: string; readonly name: string }> = [
  { id: "hh", short: "hh", name: "поля hh" },
  { id: "text", short: "текст", name: "разбор текста" },
  { id: "ai", short: "ИИ", name: "модель" }
]

export type ReconGroup = "profile" | "apply" | "risk" | "perk"

export const RECON_GROUPS: Record<ReconGroup, string> = {
  profile: "О вакансии",
  apply: "Для отклика",
  risk: "Осторожно",
  perk: "Плюсы"
}

/** `norm` is what sources are compared by; `text` is what a human reads. */
export interface ReconCell {
  readonly norm: string | null
  readonly text: string | null
}

export interface ReconRow {
  readonly key: string
  readonly group: ReconGroup
  readonly label: string
  readonly cells: Readonly<Record<ReconSource, ReconCell>>
  /** At least two sources answered, and they say different things. */
  readonly conflict: boolean
  /** Number of sources that answered. */
  readonly answered: number
  /** The text to show when the sources agree (or the single answer). */
  readonly summary: string
  readonly evidence?: string
}

const NONE: ReconCell = { norm: null, text: null }
const YES = "да"
const NO = "нет"

const yes = (text: string | null = null): ReconCell => ({ norm: YES, text })
const no = (): ReconCell => ({ norm: NO, text: null })
const bool = (value: boolean | null | undefined, text: string | null = null): ReconCell =>
  value === null || value === undefined ? NONE : value ? yes(text) : no()
const value = (norm: string, text: string): ReconCell => ({ norm, text })

type Fact<A> = { readonly value: A; readonly confidence: number } | null
const fv = <A>(fact: Fact<A> | undefined): A | null => (fact === undefined || fact === null ? null : fact.value)
const aiBool = (fact: Fact<boolean> | undefined): ReconCell => bool(fv(fact))
const aiAsk = (fact: Fact<"required" | "preferred" | "not_mentioned"> | undefined): ReconCell => {
  const v = fv(fact)
  if (v === null) return NONE
  if (v === "not_mentioned") return no()
  return yes(v === "required" ? "обязательно" : "желательно")
}

const LEVEL_NORM: Record<string, string> = {
  intern: "intern", junior: "junior", middle: "middle", senior: "senior",
  staff: "lead", tech_lead: "lead", team_lead: "lead", head: "lead", lead: "lead"
}
const HH_YEARS: Record<string, number> = { noExperience: 0, between1And3: 1, between3And6: 3, moreThan6: 6 }
const HH_YEARS_TEXT: Record<string, string> = {
  noExperience: "без опыта", between1And3: "1–3 года", between3And6: "3–6 лет", moreThan6: "более 6 лет"
}
const MODE_TEXT: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", office: "офис" }
const hhMode = (code: string): string | null => {
  const c = code.toLowerCase()
  if (c === "remote") return "remote"
  if (c === "hybrid") return "hybrid"
  if (c === "on_site" || c === "office") return "office"
  return null
}
const COMPANY: Record<string, string> = {
  product: "продуктовая", outsource: "аутсорс", outstaff: "аутстаф", integrator: "интегратор",
  consulting: "консалтинг", bank_fintech: "банк или финтех", government: "госсектор",
  startup: "стартап", recruiter: "рекрутинг"
}
const LOCATION: Record<string, string> = {
  any: "без привязки к месту", city_or_country: "нужен город или страна", relocation_help: "помогают с переездом"
}

export const buildRecon = (
  detail: VacancyDetail,
  analysis: VacancyAnalysisFacts | null
): ReadonlyArray<ReconRow> => {
  const a = analysis
  const hh = detail.facts?.hh ?? null
  const text = detail.facts?.text
  const cond = text?.conditions ?? null
  const flags = new Set((text?.redFlags ?? []).map((flag) => flag.code))
  const flagEvidence = (...codes: ReadonlyArray<string>) =>
    text?.redFlags.find((flag) => codes.includes(flag.code))?.evidence
  const requested = new Set((text?.applicationRequests ?? []).map((item) => item.code))
  const requestEvidence = (...codes: ReadonlyArray<string>) =>
    text?.applicationRequests.find((item) => codes.includes(item.code))?.evidence

  const rows: Array<ReconRow> = []
  const add = (
    key: string,
    group: ReconGroup,
    label: string,
    cells: { hh?: ReconCell; text?: ReconCell; ai?: ReconCell },
    options: { evidence?: string | undefined; always?: boolean } = {}
  ) => {
    const full = { hh: cells.hh ?? NONE, text: cells.text ?? NONE, ai: cells.ai ?? NONE }
    const known = Object.values(full).filter((cell) => cell.norm !== null)
    if (known.length === 0) return
    const positive = known.filter((cell) => cell.norm !== NO)
    // A parameter nobody confirms is not about this vacancy.
    if (positive.length === 0) return
    const norms = new Set(known.map((cell) => cell.norm))
    const lead = positive[0]!
    rows.push({
      key,
      group,
      label,
      cells: full,
      conflict: norms.size > 1,
      answered: known.length,
      summary: lead.text ?? label,
      ...(options.evidence ? { evidence: options.evidence } : {})
    })
  }

  /* ---- profile: the three sources describe the same facts ------------------ */
  const roleKey = fv(a?.role)
  if (roleKey !== null) {
    add("role", "profile", "Роль", { ai: value(roleKey, ANALYSIS_ROLE_LABELS[roleKey] ?? roleKey) })
  }
  // The regex source reads the level from the title, the model from the whole text.
  const titleSeniority = detail.vacancy.seniority
  const aiLevel = fv(a?.requiredLevel) ?? fv(a?.titleLevel)
  add("level", "profile", "Уровень", {
    text:
      titleSeniority === "unknown"
        ? NONE
        : value(LEVEL_NORM[titleSeniority] ?? titleSeniority, seniorityLabel(titleSeniority)),
    ai: aiLevel === null ? NONE : value(LEVEL_NORM[aiLevel] ?? aiLevel, ANALYSIS_LEVEL_LABELS[aiLevel] ?? aiLevel)
  })
  const code = detail.vacancy.experienceCode ?? null
  const aiYears = fv(a?.yearsMin)
  add("experience", "profile", "Опыт", {
    hh:
      code !== null && HH_YEARS[code] !== undefined
        ? value(String(HH_YEARS[code]), HH_YEARS_TEXT[code] ?? code)
        : NONE,
    ai:
      aiYears === null
        ? NONE
        : value(String(Math.round(aiYears)), aiYears <= 0 ? "без опыта" : `от ${Math.round(aiYears)} лет`)
  })
  // hh lists every format the employer allows ("гибрид, удалённо"); the model picks the one
  // the text really describes. A pick inside hh's list is a refinement, not a conflict.
  const hhModes = [...new Set(detail.vacancy.workFormats.map(hhMode).filter((m): m is string => m !== null))].sort()
  const aiMode = fv(a?.workMode)
  const aiModeKnown = aiMode !== null && aiMode !== "unspecified" ? aiMode : null
  const hhModeText = hhModes.map((m) => MODE_TEXT[m] ?? m).join(", ")
  add("format", "profile", "Формат", {
    hh:
      hhModes.length === 0
        ? NONE
        : value(aiModeKnown !== null && hhModes.includes(aiModeKnown) ? aiModeKnown : hhModes.join("+"), hhModeText),
    ai: aiModeKnown === null ? NONE : value(aiModeKnown, MODE_TEXT[aiModeKnown] ?? aiModeKnown)
  })
  const aiEmployment = fv(a?.employment)
  add("employment", "profile", "Оформление", {
    hh: detail.vacancy.employmentForm
      ? { norm: null, text: employmentFormLabel(detail.vacancy.employmentForm) }
      : NONE,
    text: cond?.officialEmployment === true ? value("labor_code", "по ТК") : NONE,
    ai:
      aiEmployment === "labor_code"
        ? value("labor_code", "по ТК")
        : aiEmployment === "contractor"
          ? value("contractor", "ИП, самозанятость или ГПХ")
          : NONE
  })
  const company = fv(a?.companyType)
  if (company !== null) add("company", "profile", "Компания", { ai: value(company, COMPANY[company] ?? company) })
  const location = fv(a?.locationRequirement)
  if (location !== null && LOCATION[location]) {
    add("location", "profile", "Где быть", { ai: value(location, LOCATION[location]!) })
  }
  if (fv(a?.managesPeople) === true) add("manages", "profile", "Управление людьми", { ai: yes() })
  if (fv(a?.soloRole) === true) add("solo", "profile", "Единственный в роли", { ai: yes() })
  const internship = fv(a?.internship)
  if (internship === "paid") add("internship", "profile", "Оплачиваемая стажировка", { ai: yes() })

  /* ---- what the response needs --------------------------------------------- */
  add("letter", "apply", "Сопроводительное письмо", {
    // hh not forcing a letter says nothing about whether the employer wants one.
    hh: hh?.letterRequired === true ? yes("обязательно") : NONE,
    text: text?.coverLetter.requested ? yes("упомянуто") : NONE,
    ai: aiAsk(a?.coverLetter)
  }, { evidence: text?.coverLetter.evidence ?? undefined })
  const testTextual = cond?.testTask ?? null
  const aiTest = fv(a?.testTask)
  add("test", "apply", "Тест или тестовое", {
    hh: hh === null ? NONE : bool(hh.test.hasTest, hh.test.required === false ? "необязательный тест" : "тест на hh"),
    text: testTextual === null ? NONE : testTextual === "none" ? no() : yes("в тексте"),
    ai: aiTest === null ? NONE : aiTest === "none" ? no() : yes(aiTest === "paid" ? "оплачивается" : aiTest === "unpaid" ? "не оплачивается" : null)
  })
  add("repo", "apply", "Ссылка на репозиторий", {
    text: requested.has("github") || requested.has("code_samples") ? yes("просят") : NONE,
    ai: aiAsk(a?.repo)
  }, { evidence: requestEvidence("github", "code_samples") })
  add("portfolio", "apply", "Портфолио", {
    text: requested.has("portfolio") ? yes("просят") : NONE,
    ai: aiAsk(a?.portfolio)
  }, { evidence: requestEvidence("portfolio") })
  add("about", "apply", applicationRequestLabel("motivation") + " или о себе", {
    text: requested.has("motivation") || requested.has("about_me") ? yes("просят") : NONE,
    ai: aiAsk(a?.answersInReply)
  }, { evidence: requestEvidence("motivation", "about_me") })
  add("contact", "apply", "Связаться вне hh", { ai: aiAsk(a?.contactOutside) })
  add("form", "apply", "Внешняя анкета или видео", { ai: aiAsk(a?.externalForm) })
  add("salaryAsk", "apply", "Зарплатные ожидания", { ai: aiAsk(a?.salaryExpectation) })
  const englishLevel = cond?.englishLevel ?? null
  add("english", "apply", englishLevel ? `Английский ${englishLevel}` : "Английский", {
    text:
      cond === null || (cond.englishLevel === null && cond.englishRequired === null)
        ? NONE
        : yes(cond.englishRequired === false ? "желательно" : "обязательно"),
    ai: aiAsk(a?.english)
  })

  /* ---- risks --------------------------------------------------------------- */
  add("overtime", "risk", "Переработки", {
    text: cond?.overtime == null ? NONE : cond.overtime === "none" ? no() : yes(),
    ai: aiBool(a?.overtime)
  }, { evidence: cond?.evidence.overtime })
  add("oncall", "risk", "Дежурства", { text: bool(cond?.onCall), ai: aiBool(a?.onCall) }, { evidence: cond?.evidence.onCall })
  add("trips", "risk", "Командировки", {
    text: cond?.businessTrips == null ? NONE : cond.businessTrips === "none" ? no() : yes(),
    ai: aiBool(a?.businessTrips)
  }, { evidence: cond?.evidence.businessTrips })
  add("night", "risk", "Ночью или в выходные", {
    text: flags.has("night_shifts") || flags.has("weekend_work") ? yes() : NONE,
    ai: aiBool(a?.nightOrWeekend)
  }, { evidence: flagEvidence("night_shifts", "weekend_work") })
  add("probationBad", "risk", "Испытательный без оплаты или со скидкой", {
    text: flags.has("probation_unpaid") || cond?.probationPaid === false ? yes() : NONE,
    ai: aiBool(a?.probationUnpaidOrReduced)
  }, { evidence: flagEvidence("probation_unpaid") })
  add("citizenship", "risk", "Нужно гражданство", {
    text: bool(cond?.citizenshipRequired),
    ai: aiBool(a?.citizenshipRequired)
  }, { evidence: cond?.evidence.citizenshipRequired })
  add("relocation", "risk", "Нужен переезд", { ai: aiBool(a?.relocationRequired) })
  add("testUnpaid", "risk", "Неоплачиваемое тестовое", {
    text: flags.has("unpaid_test") || testTextual === "unpaid" ? yes() : NONE,
    ai: aiTest === null ? NONE : aiTest === "unpaid" ? yes() : no()
  }, { evidence: flagEvidence("unpaid_test") })
  if (internship === "unpaid") add("internUnpaid", "risk", "Неоплачиваемая стажировка", { ai: yes() })
  add("stress", "risk", "«Стрессоустойчивость»", {
    text: flags.has("stress") ? yes() : NONE,
    ai: aiBool(a?.redFlags.stress)
  }, { evidence: flagEvidence("stress") })
  add("multitask", "risk", "«Многозадачность»", {
    text: flags.has("multitasking") ? yes() : NONE,
    ai: aiBool(a?.redFlags.multitask)
  }, { evidence: flagEvidence("multitasking") })
  add("scam", "risk", "Признаки обмана", {
    text: flags.has("job_scam") ? yes() : NONE,
    ai: aiBool(a?.redFlags.scam)
  }, { evidence: flagEvidence("job_scam") })
  add("discrimination", "risk", "Ограничения по возрасту или полу", {
    text: flags.has("age_limit") || flags.has("gender_limit") ? yes() : NONE,
    ai: aiBool(a?.redFlags.discrimination)
  }, { evidence: flagEvidence("age_limit", "gender_limit") })
  for (const flag of ["work_24_7", "fines", "no_contract", "salary_in_cash"] as const) {
    if (flags.has(flag)) add(`flag-${flag}`, "risk", redFlagLabel(flag), { text: yes() }, { evidence: flagEvidence(flag) })
  }
  if (a !== null && fv(a.isIt) === false) add("notIt", "risk", "Не IT-вакансия", { ai: yes() })

  /* ---- pluses -------------------------------------------------------------- */
  const hasSalary = detail.vacancy.salaryFrom != null || detail.vacancy.salaryTo != null
  const textSalary = text?.salary ?? null
  add("salary", "perk", "Зарплата указана", {
    hh: hasSalary ? yes() : no(),
    text: textSalary === null ? NONE : yes(textSalary.evidence),
    ai: aiBool(a?.salaryInText)
  })
  add("bonus", "perk", "Премии", { ai: aiBool(a?.bonus) })
  add("dms", "perk", "ДМС", { ai: aiBool(a?.healthInsurance) })
  add("edu", "perk", "Бюджет на обучение", { ai: aiBool(a?.educationBudget) })

  return rows
}

export const reconByKey = (rows: ReadonlyArray<ReconRow>): ReadonlyMap<string, ReconRow> =>
  new Map(rows.map((row) => [row.key, row]))

/** How one source relates to the row: said it, said otherwise, or is silent. */
export type ReconStance = "yes" | "other" | "silent"
export const stanceOf = (row: ReconRow, source: ReconSource): ReconStance => {
  const cell = row.cells[source]
  if (cell.norm === null && cell.text === null) return "silent"
  if (cell.norm === null) return "yes"
  if (cell.norm === NO) return "other"
  // Positive value: "yes" when it equals the first positive answer.
  const lead = (Object.values(row.cells).find((c) => c.norm !== null && c.norm !== NO) ?? cell).norm
  return cell.norm === lead ? "yes" : "other"
}
