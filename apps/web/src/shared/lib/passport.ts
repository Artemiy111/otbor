import type { VacancyAnalysisFacts, VacancyDetail } from "@otbor/contract"
import {
  ANALYSIS_LEVEL_LABELS,
  ANALYSIS_ROLE_LABELS
} from "./analysis"
import { applicationRequestLabel, conditionFacts, redFlagLabel, scheduleCodeLabel } from "./vacancy-facts"

/**
 * The "vacancy passport": only what is true and relevant for THIS vacancy.
 * Confident "no" answers and unknowns are not shown at all, a missing line is
 * the answer. Pure function: the view is rendered by `VacancyPassport.vue`.
 */

export type PassportIcon =
  | "home" | "building" | "briefcase" | "pin" | "users" | "user" | "graduation" | "banknote"
  | "mail" | "branch" | "folder" | "chat" | "phone" | "video" | "wallet" | "flask" | "globe"
  | "clock" | "moon" | "plane" | "alert" | "shield" | "heart" | "gift" | "file" | "flag"

export interface PassportItem {
  readonly key: string
  readonly label: string
  readonly icon: PassportIcon
  /** Quoted sentence from the vacancy or a short explanation. */
  readonly detail?: string
}

export interface PassportTile extends PassportItem {
  readonly value: string
}

export interface PassportRequest extends PassportItem {
  readonly level: "required" | "preferred"
}

export interface PassportLadder {
  /** Step of the level in the title, 0..4. */
  readonly title: number | null
  readonly titleLabel: string | null
  /** Step of the level the text actually requires, 0..4. */
  readonly required: number | null
  readonly requiredLabel: string | null
}

export interface PassportView {
  readonly role: string | null
  readonly notIt: boolean
  readonly ladder: PassportLadder
  readonly years: number | null
  readonly tiles: ReadonlyArray<PassportTile>
  readonly requests: ReadonlyArray<PassportRequest>
  readonly warnings: ReadonlyArray<PassportItem>
  readonly perks: ReadonlyArray<PassportItem>
  readonly numbers: ReadonlyArray<{ readonly key: string; readonly label: string; readonly value: string }>
  readonly analysed: boolean
}

export const LADDER_STEPS = ["Стажёр", "Junior", "Middle", "Senior", "Lead"] as const

const STEP: Record<string, number> = {
  intern: 0,
  junior: 1,
  middle: 2,
  senior: 3,
  staff: 4,
  tech_lead: 4,
  team_lead: 4,
  head: 4
}

const COMPANY: Record<string, string> = {
  product: "Продуктовая",
  outsource: "Аутсорс",
  outstaff: "Аутстаф",
  integrator: "Интегратор",
  consulting: "Консалтинг",
  bank_fintech: "Банк или финтех",
  government: "Госсектор",
  startup: "Стартап",
  recruiter: "Рекрутинг"
}
const MODE: Record<string, string> = { remote: "Удалённо", hybrid: "Гибрид", office: "Офис" }
const EMPLOYMENT: Record<string, string> = {
  labor_code: "Официально, по ТК",
  contractor: "ИП, самозанятость или ГПХ"
}
const LOCATION: Record<string, string> = {
  any: "Без привязки к месту",
  city_or_country: "Нужен город или страна",
  relocation_help: "Помогают с переездом"
}

type Fact<A> = { readonly value: A; readonly confidence: number } | null
const val = <A>(fact: Fact<A>): A | null => (fact === null ? null : fact.value)

export const buildPassport = (
  analysis: VacancyAnalysisFacts | null,
  detail: VacancyDetail
): PassportView => {
  const hh = detail.facts?.hh ?? null
  const text = detail.facts?.text
  const a = analysis

  /* ---- hero ---------------------------------------------------------------- */
  const roleKey = a ? val(a.role) : null
  const titleKey = a ? val(a.titleLevel) : null
  const requiredKey = a ? val(a.requiredLevel) : null
  const yearsRaw = a ? val(a.yearsMin) : null
  const years = yearsRaw !== null && yearsRaw > 0 ? Math.round(yearsRaw) : null

  /* ---- tiles (neutral facts about the job) --------------------------------- */
  const tiles: Array<PassportTile> = []
  const addTile = (tile: PassportTile | null) => tile !== null && tiles.push(tile)
  const mode = a ? val(a.workMode) : null
  if (mode !== null && MODE[mode]) addTile({ key: "mode", label: "Формат", value: MODE[mode]!, icon: "home" })
  const company = a ? val(a.companyType) : null
  if (company !== null) addTile({ key: "company", label: "Компания", value: COMPANY[company] ?? company, icon: "building" })
  const employment = a ? val(a.employment) : null
  if (employment !== null && EMPLOYMENT[employment]) {
    addTile({ key: "employment", label: "Оформление", value: EMPLOYMENT[employment]!, icon: "briefcase" })
  }
  const location = a ? val(a.locationRequirement) : null
  if (location !== null && LOCATION[location]) {
    addTile({ key: "location", label: "Где быть", value: LOCATION[location]!, icon: "pin" })
  }
  if (a && val(a.managesPeople) === true) addTile({ key: "manages", label: "Роль", value: "Управление людьми", icon: "users" })
  if (a && val(a.soloRole) === true) addTile({ key: "solo", label: "Роль", value: "Единственный в роли", icon: "user" })
  const internship = a ? val(a.internship) : null
  if (internship === "paid") addTile({ key: "intern", label: "Формат", value: "Оплачиваемая стажировка", icon: "graduation" })
  const schedule = hh ? [...hh.workScheduleDays, ...hh.workingHours].map(scheduleCodeLabel) : []
  if (schedule.length > 0) addTile({ key: "schedule", label: "График", value: schedule.join(", "), icon: "clock" })

  /* ---- what the response needs --------------------------------------------- */
  const requests: Array<PassportRequest> = []
  const seen = new Set<string>()
  const request = (
    key: string,
    label: string,
    icon: PassportIcon,
    level: "required" | "preferred" | null | undefined,
    detail?: string
  ) => {
    if (level === null || level === undefined) return
    const existing = requests.findIndex((item) => item.key === key)
    if (existing >= 0) {
      if (level === "required" && requests[existing]!.level !== "required") {
        requests[existing] = { ...requests[existing]!, level }
      }
      return
    }
    seen.add(key)
    requests.push({ key, label, icon, level, ...(detail ? { detail } : {}) })
  }
  const asked = (fact: Fact<"required" | "preferred" | "not_mentioned"> | undefined) => {
    const v = fact === undefined ? null : val(fact)
    return v === "required" || v === "preferred" ? v : null
  }
  if (hh?.letterRequired === true) request("letter", "Сопроводительное письмо", "mail", "required", "hh не даст откликнуться без письма")
  request("letter", "Сопроводительное письмо", "mail", asked(a?.coverLetter), text?.coverLetter.evidence ?? undefined)
  if (text?.coverLetter.requested === true) request("letter", "Сопроводительное письмо", "mail", "required", text.coverLetter.evidence ?? undefined)
  request("repo", "Ссылка на репозиторий", "branch", asked(a?.repo))
  request("portfolio", "Портфолио", "folder", asked(a?.portfolio))
  request("answers", "Ответы на вопросы в отклике", "chat", asked(a?.answersInReply))
  request("contact", "Связаться вне hh", "phone", asked(a?.contactOutside))
  request("form", "Внешняя анкета или видео", "video", asked(a?.externalForm))
  request("salary", "Зарплатные ожидания", "wallet", asked(a?.salaryExpectation))
  for (const item of text?.applicationRequests ?? []) {
    const key =
      item.code === "github" || item.code === "code_samples" ? "repo" : item.code === "portfolio" ? "portfolio" : item.code
    request(key, applicationRequestLabel(item.code), item.code === "portfolio" ? "folder" : item.code === "about_me" || item.code === "motivation" ? "chat" : "branch", "required", item.evidence)
  }
  if (hh?.test.hasTest === true) {
    request("hh-test", "Тест работодателя на hh", "flask", hh.test.required === false ? "preferred" : "required")
  }
  const testTask = a ? val(a.testTask) : null
  if (testTask === "paid") request("test-task", "Тестовое задание, оплачивается", "flask", "required")
  if (testTask === "unspecified") request("test-task", "Тестовое задание", "flask", "required")
  const english = a ? val(a.english) : null
  const englishLevel = text?.conditions?.englishLevel ?? null
  if (english === "required" || english === "preferred") {
    request("english", englishLevel ? `Английский, ${englishLevel}` : "Английский", "globe", english)
  }
  requests.sort((x, y) => (x.level === y.level ? 0 : x.level === "required" ? -1 : 1))

  /* ---- warnings ------------------------------------------------------------ */
  const warnings: Array<PassportItem> = []
  const warn = (key: string, label: string, icon: PassportIcon, on: Fact<boolean> | undefined, detail?: string) => {
    if (on !== undefined && val(on) === true) warnings.push({ key, label, icon, ...(detail ? { detail } : {}) })
  }
  if (a) {
    if (val(a.isIt) === false) warnings.push({ key: "not-it", label: "Не IT-вакансия", icon: "alert" })
    warn("overtime", "Переработки", "clock", a.overtime)
    warn("oncall", "Дежурства", "alert", a.onCall)
    warn("night", "Ночью или в выходные", "moon", a.nightOrWeekend)
    warn("trips", "Командировки", "plane", a.businessTrips)
    warn("probation", "Испытательный срок неоплачиваемый или со скидкой", "wallet", a.probationUnpaidOrReduced)
    warn("relocation", "Нужен переезд", "pin", a.relocationRequired)
    warn("citizenship", "Нужно гражданство", "flag", a.citizenshipRequired)
    warn("stress", "«Стрессоустойчивость» в тексте", "shield", a.redFlags.stress)
    warn("multitask", "«Многозадачность» в тексте", "shield", a.redFlags.multitask)
    warn("scam", "Признаки обмана", "alert", a.redFlags.scam)
    warn("discrimination", "Ограничения по возрасту или полу", "alert", a.redFlags.discrimination)
    if (testTask === "unpaid") warnings.push({ key: "test-unpaid", label: "Неоплачиваемое тестовое", icon: "flask" })
    if (internship === "unpaid") warnings.push({ key: "intern-unpaid", label: "Неоплачиваемая стажировка", icon: "graduation" })
  }
  const covered = new Set<string>(
    warnings.flatMap((w) =>
      w.key === "stress" ? ["stress"] :
      w.key === "multitask" ? ["multitasking"] :
      w.key === "overtime" ? ["overtime"] :
      w.key === "night" ? ["night_shifts", "weekend_work"] :
      w.key === "test-unpaid" ? ["unpaid_test"] :
      w.key === "probation" ? ["probation_unpaid"] :
      w.key === "scam" ? ["job_scam"] :
      w.key === "discrimination" ? ["age_limit", "gender_limit"] : []
    )
  )
  for (const flag of text?.redFlags ?? []) {
    if (covered.has(flag.code)) continue
    warnings.push({ key: `flag-${flag.code}`, label: redFlagLabel(flag.code), icon: "alert", detail: flag.evidence })
  }

  /* ---- perks --------------------------------------------------------------- */
  const perks: Array<PassportItem> = []
  const perk = (key: string, label: string, icon: PassportIcon, on: Fact<boolean> | undefined) => {
    if (on !== undefined && val(on) === true) perks.push({ key, label, icon })
  }
  if (a) {
    perk("salary", "Зарплата указана в тексте", "banknote", a.salaryInText)
    perk("bonus", "Премии", "gift", a.bonus)
    perk("dms", "ДМС", "heart", a.healthInsurance)
    perk("edu", "Бюджет на обучение", "graduation", a.educationBudget)
  }

  /* ---- numbers found by the text detectors (only informative ones) --------- */
  const wanted = new Set(["probation", "interviewStages", "vacation", "sickLeave"])
  const numbers = (text?.conditions ? conditionFacts(text.conditions) : [])
    .filter((fact) => wanted.has(fact.key))
    .filter((fact) => !["нет", "не оплачивается", "не обязателен"].includes(fact.value))
    .map(({ key, label, value }) => ({ key, label, value }))

  return {
    role: roleKey === null ? null : (ANALYSIS_ROLE_LABELS[roleKey] ?? roleKey),
    notIt: a !== null && val(a.isIt) === false,
    ladder: {
      title: titleKey === null ? null : (STEP[titleKey] ?? null),
      titleLabel: titleKey === null ? null : (ANALYSIS_LEVEL_LABELS[titleKey] ?? titleKey),
      required: requiredKey === null ? null : (STEP[requiredKey] ?? null),
      requiredLabel: requiredKey === null ? null : (ANALYSIS_LEVEL_LABELS[requiredKey] ?? requiredKey)
    },
    years,
    tiles,
    requests,
    warnings,
    perks,
    numbers,
    analysed: analysis !== null
  }
}
