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

const REQUEST_LABELS: Record<string, string> = {
  required: "обязательно",
  preferred: "желательно"
}

export interface AnalysisRow {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly confidence: number
  /** A fact worth a warning colour (unpaid test, red flag). */
  readonly warn?: boolean
}

type Fact<A> = { readonly value: A; readonly confidence: number } | null

export interface AnalysisView {
  /** Identity and level of the vacancy. */
  readonly profile: ReadonlyArray<AnalysisRow>
  /** What the response must contain: required first, then preferred. */
  readonly requests: ReadonlyArray<AnalysisRow>
  /** Work conditions: test task, overtime, on-call and the like. */
  readonly conditions: ReadonlyArray<AnalysisRow>
  readonly redFlags: ReadonlyArray<AnalysisRow>
  /** Whether the model was confident about anything at all. */
  readonly empty: boolean
}

/**
 * Turns the stored facts into display rows. A fact the model was not confident
 * about is `null` in the stored analysis and is simply not a row: low
 * confidence never reads as a fact.
 */
export const describeAnalysis = (facts: VacancyAnalysisFacts): AnalysisView => {
  const row = <A>(
    key: string,
    label: string,
    fact: Fact<A>,
    show: (value: A) => string | null,
    warn?: (value: A) => boolean
  ): ReadonlyArray<AnalysisRow> => {
    if (fact === null) return []
    const value = show(fact.value)
    if (value === null) return []
    return [{
      key,
      label,
      value,
      confidence: fact.confidence,
      ...(warn?.(fact.value) ? { warn: true } : {})
    }]
  }
  const flag = (key: string, label: string, fact: Fact<boolean>, warn = false) =>
    row(key, label, fact, (value) => (value ? "да" : null), () => warn)

  const profile = [
    ...row("role", "Роль", facts.role, (v) => ANALYSIS_ROLE_LABELS[v] ?? v),
    ...row("titleLevel", "Уровень в заголовке", facts.titleLevel, (v) => ANALYSIS_LEVEL_LABELS[v] ?? v),
    ...row("requiredLevel", "Требуемый уровень", facts.requiredLevel, (v) => ANALYSIS_LEVEL_LABELS[v] ?? v),
    ...row("companyType", "Компания", facts.companyType, (v) => COMPANY_TYPE_LABELS[v] ?? v),
    ...flag("managesPeople", "Управление людьми", facts.managesPeople)
  ]

  const requests = [
    ["coverLetter", "Сопроводительное письмо", facts.coverLetter],
    ["repo", "Ссылка на репозиторий", facts.repo],
    ["portfolio", "Портфолио", facts.portfolio],
    ["answersInReply", "Ответы на вопросы в отклике", facts.answersInReply],
    ["contactOutside", "Связаться вне hh", facts.contactOutside],
    ["externalForm", "Внешняя анкета", facts.externalForm],
    ["salaryExpectation", "Зарплатные ожидания", facts.salaryExpectation]
  ].flatMap(([key, label, fact]) =>
    row(key as string, label as string, fact as Fact<string>, (v) => REQUEST_LABELS[v] ?? null)
  ).sort((a, b) => Number(b.value === "обязательно") - Number(a.value === "обязательно"))

  const conditions = [
    ...row("testTask", "Тестовое задание", facts.testTask, (v) => TEST_TASK_LABELS[v] ?? v, (v) => v === "unpaid"),
    ...flag("overtime", "Переработки", facts.overtime, true),
    ...flag("onCall", "Дежурства", facts.onCall, true),
    ...flag("nightOrWeekend", "Ночью или в выходные", facts.nightOrWeekend, true),
    ...flag("businessTrips", "Командировки", facts.businessTrips),
    ...row("english", "Английский", facts.english, (v) => REQUEST_LABELS[v] ?? null)
  ]

  const redFlags = [
    ...flag("stress", "Стрессоустойчивость", facts.redFlags.stress, true),
    ...flag("multitask", "Многозадачность", facts.redFlags.multitask, true),
    ...flag("scam", "Признаки обмана", facts.redFlags.scam, true),
    ...flag("discrimination", "Ограничения по возрасту или полу", facts.redFlags.discrimination, true)
  ]

  return {
    profile,
    requests,
    conditions,
    redFlags,
    empty: profile.length + requests.length + conditions.length + redFlags.length === 0
  }
}
