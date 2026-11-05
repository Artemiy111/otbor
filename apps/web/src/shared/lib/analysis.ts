import type { VacancyAnalysisFacts } from "@otbor/contract"

export const ANALYSIS_ROLE_LABELS: Readonly<Record<string, string>> = {
  devops: "DevOps",
  sre: "SRE",
  platform: "Платформа",
  sysadmin: "Сисадмин",
  security: "Безопасность",
  backend: "Backend",
  frontend: "Frontend",
  fullstack: "Fullstack",
  mobile: "Мобильная разработка",
  qa: "QA",
  data: "Данные",
  analyst: "Аналитик",
  dba: "DBA",
  support: "Поддержка",
  manager: "Менеджер",
  other: "Другое"
}

export const ANALYSIS_LEVEL_LABELS: Readonly<Record<string, string>> = {
  intern: "Стажёр",
  junior: "Junior",
  middle: "Middle",
  senior: "Senior",
  staff: "Staff",
  tech_lead: "Техлид",
  team_lead: "Тимлид",
  head: "Руководитель"
}

const COMPANY_TYPE_LABELS: Record<string, string> = {
  product: "продуктовая",
  outsource: "аутсорс",
  outstaff: "аутстаф",
  integrator: "интегратор",
  consulting: "консалтинг",
  bank_fintech: "банк или финтех",
  government: "госсектор",
  startup: "стартап",
  recruiter: "рекрутинг"
}

const TEST_TASK_LABELS: Record<string, string> = {
  none: "нет",
  paid: "оплачивается",
  unpaid: "не оплачивается",
  unspecified: "возможно, не указано"
}

const WORK_MODE_LABELS: Record<string, string> = {
  remote: "удалённо",
  hybrid: "гибрид",
  office: "офис",
  unspecified: "не указан"
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  labor_code: "официально, по ТК",
  contractor: "ИП, самозанятость или ГПХ",
  unspecified: "не указано"
}

const LOCATION_LABELS: Record<string, string> = {
  any: "без привязки к месту",
  city_or_country: "нужен город или страна, либо офис",
  relocation_help: "помогают с переездом",
  unspecified: "не указано"
}

const INTERNSHIP_LABELS: Record<string, string> = {
  not_internship: "нет",
  paid: "оплачиваемая стажировка",
  unpaid: "неоплачиваемая стажировка",
  unspecified: "стажировка, оплата не указана"
}

/** How a row should read: warn is a risk, good is a plus, muted is a confident "no". */
export type AnalysisTone = "neutral" | "good" | "warn" | "muted"

export interface AnalysisRow {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly confidence: number
  readonly tone: AnalysisTone
}

type Fact<A> = { readonly value: A; readonly confidence: number } | null

export interface AnalysisView {
  /** Identity, level, experience, format. */
  readonly profile: ReadonlyArray<AnalysisRow>
  /** What the response must contain: required first, then preferred, then "not asked". */
  readonly requests: ReadonlyArray<AnalysisRow>
  /** Test task, overtime, on-call, probation, trips, language, location. */
  readonly conditions: ReadonlyArray<AnalysisRow>
  /** Salary in text, bonus, insurance, education budget. */
  readonly perks: ReadonlyArray<AnalysisRow>
  readonly redFlags: ReadonlyArray<AnalysisRow>
  /** Labels of facts the model could not decide with enough confidence. */
  readonly unknown: ReadonlyArray<string>
  readonly confident: number
  readonly total: number
}

const years = (value: number): string => {
  const n = Math.round(value)
  if (n <= 0) return "не указан"
  const last = n % 10
  const word = n % 100 >= 11 && n % 100 <= 14 ? "лет" : last === 1 ? "год" : last >= 2 && last <= 4 ? "года" : "лет"
  return `от ${n} ${word}`
}

/**
 * Turns the stored facts into display rows. A fact the model was not confident
 * about is `null` in the stored analysis: it is not a row, it is listed once
 * under "не определено". A confident "no" is shown, muted, because "нет
 * переработок" is information.
 */
export const describeAnalysis = (facts: VacancyAnalysisFacts): AnalysisView => {
  const unknown: string[] = []
  let confident = 0
  let total = 0

  const row = <A>(
    key: string,
    label: string,
    fact: Fact<A>,
    show: (value: A) => { text: string; tone?: AnalysisTone } | null
  ): ReadonlyArray<AnalysisRow> => {
    total += 1
    if (fact === null) {
      unknown.push(label)
      return []
    }
    confident += 1
    const shown = show(fact.value)
    if (shown === null) return []
    return [{ key, label, value: shown.text, confidence: fact.confidence, tone: shown.tone ?? "neutral" }]
  }
  const yesNo = (
    key: string,
    label: string,
    fact: Fact<boolean>,
    yes: AnalysisTone,
    texts: readonly [string, string] = ["да", "нет"]
  ) => row(key, label, fact, (v) => (v ? { text: texts[0], tone: yes } : { text: texts[1], tone: "muted" }))
  const asked = (key: string, label: string, fact: Fact<string>) =>
    row(key, label, fact, (v) =>
      v === "required"
        ? { text: "обязательно", tone: "warn" }
        : v === "preferred"
          ? { text: "желательно", tone: "neutral" }
          : { text: "не просят", tone: "muted" }
    )
  const mapped = (key: string, label: string, fact: Fact<string>, labels: Record<string, string>) =>
    row(key, label, fact, (v) => ({ text: labels[v] ?? v }))

  const profile = [
    ...yesNo("isIt", "IT-вакансия", facts.isIt, "neutral"),
    ...mapped("role", "Роль", facts.role, ANALYSIS_ROLE_LABELS),
    ...mapped("titleLevel", "Уровень в заголовке", facts.titleLevel, ANALYSIS_LEVEL_LABELS),
    ...mapped("requiredLevel", "Требуемый уровень", facts.requiredLevel, ANALYSIS_LEVEL_LABELS),
    ...row("yearsMin", "Опыт", facts.yearsMin, (v) => ({ text: years(v) })),
    ...yesNo("managesPeople", "Управление людьми", facts.managesPeople, "neutral"),
    ...mapped("companyType", "Компания", facts.companyType, COMPANY_TYPE_LABELS),
    ...mapped("workMode", "Формат работы", facts.workMode, WORK_MODE_LABELS),
    ...mapped("locationRequirement", "Где нужно быть", facts.locationRequirement, LOCATION_LABELS),
    ...mapped("employment", "Оформление", facts.employment, EMPLOYMENT_LABELS),
    ...row("internship", "Стажировка", facts.internship, (v) => ({
      text: INTERNSHIP_LABELS[v] ?? v,
      tone: v === "not_internship" ? "muted" : v === "unpaid" ? "warn" : "neutral"
    }))
  ]

  const requests = [
    ...asked("coverLetter", "Сопроводительное письмо", facts.coverLetter),
    ...asked("repo", "Ссылка на репозиторий", facts.repo),
    ...asked("portfolio", "Портфолио", facts.portfolio),
    ...asked("answersInReply", "Ответы на вопросы в отклике", facts.answersInReply),
    ...asked("contactOutside", "Связаться вне hh", facts.contactOutside),
    ...asked("externalForm", "Внешняя анкета или видео", facts.externalForm),
    ...asked("salaryExpectation", "Зарплатные ожидания", facts.salaryExpectation)
  ].sort((a, b) => rank(a) - rank(b))

  const conditions = [
    ...row("testTask", "Тестовое задание", facts.testTask, (v) =>
      v === "none"
        ? { text: "нет", tone: "muted" }
        : { text: TEST_TASK_LABELS[v] ?? v, tone: v === "unpaid" ? "warn" : "neutral" }
    ),
    ...yesNo("overtime", "Переработки", facts.overtime, "warn"),
    ...yesNo("onCall", "Дежурства", facts.onCall, "warn"),
    ...yesNo("nightOrWeekend", "Ночью или в выходные", facts.nightOrWeekend, "warn"),
    ...yesNo("businessTrips", "Командировки", facts.businessTrips, "neutral"),
    ...yesNo("probation", "Испытательный срок", facts.probation, "neutral"),
    ...yesNo("probationUnpaidOrReduced", "Срок неоплачиваемый или со скидкой", facts.probationUnpaidOrReduced, "warn"),
    ...asked("english", "Английский", facts.english),
    ...yesNo("relocationRequired", "Нужен переезд", facts.relocationRequired, "warn"),
    ...yesNo("citizenshipRequired", "Нужно гражданство", facts.citizenshipRequired, "warn"),
    ...yesNo("soloRole", "Единственный в роли", facts.soloRole, "neutral")
  ]

  const perks = [
    ...yesNo("salaryInText", "Зарплата в тексте", facts.salaryInText, "good"),
    ...yesNo("bonus", "Премии", facts.bonus, "good"),
    ...yesNo("healthInsurance", "ДМС", facts.healthInsurance, "good"),
    ...yesNo("educationBudget", "Бюджет на обучение", facts.educationBudget, "good")
  ]

  const redFlags = [
    ...yesNo("stress", "Стрессоустойчивость", facts.redFlags.stress, "warn"),
    ...yesNo("multitask", "Многозадачность", facts.redFlags.multitask, "warn"),
    ...yesNo("scam", "Признаки обмана", facts.redFlags.scam, "warn"),
    ...yesNo("discrimination", "Ограничения по возрасту или полу", facts.redFlags.discrimination, "warn")
  ]

  return { profile, requests, conditions, perks, redFlags, unknown, confident, total }
}

const rank = (row: AnalysisRow): number => (row.tone === "warn" ? 0 : row.tone === "muted" ? 2 : 1)
