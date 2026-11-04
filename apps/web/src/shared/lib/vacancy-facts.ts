import type { VacancyConditions } from "@otbor/contract"

const RED_FLAG_LABELS: Record<string, string> = {
  unpaid_test: "неоплачиваемое тестовое",
  overtime: "переработки",
  stress: "стрессоустойчивость",
  multitasking: "многозадачность",
  work_24_7: "режим 24/7",
  fines: "штрафы/удержания",
  no_contract: "без оформления",
  age_limit: "возрастное ограничение",
  gender_limit: "гендерное ограничение",
  night_shifts: "ночные смены",
  weekend_work: "работа в выходные",
  salary_in_cash: "зарплата в конверте",
  probation_unpaid: "неоплачиваемый испытательный срок",
  job_scam: "оплата за трудоустройство"
}

const APPLICATION_REQUEST_LABELS: Record<string, string> = {
  github: "GitHub",
  portfolio: "портфолио",
  code_samples: "примеры кода",
  about_me: "рассказ о себе",
  motivation: "мотивация"
}

const OVERTIME_LABELS: Record<string, string> = {
  none: "без переработок",
  possible: "переработки возможны",
  paid: "переработки оплачиваются",
  unpaid: "переработки не оплачиваются"
}

const TRIPS_LABELS: Record<string, string> = {
  none: "без командировок",
  possible: "командировки",
  frequent: "частые командировки"
}

const TEST_TASK_LABELS: Record<string, string> = {
  none: "без тестового",
  possible: "тестовое задание",
  paid: "тестовое оплачивается",
  unpaid: "тестовое не оплачивается"
}

export const redFlagLabel = (code: string): string => RED_FLAG_LABELS[code] ?? code
export const applicationRequestLabel = (code: string): string =>
  APPLICATION_REQUEST_LABELS[code] ?? code
export const overtimeLabel = (value: string): string => OVERTIME_LABELS[value] ?? value
export const testTaskLabel = (value: string): string => TEST_TASK_LABELS[value] ?? value
export const businessTripsLabel = (value: string, percent?: number | null): string =>
  value === "percent"
    ? percent === null || percent === undefined
      ? "командировки"
      : `командировки до ${percent}%`
    : (TRIPS_LABELS[value] ?? value)

export type ConditionFact = { key: string; label: string; value: string; evidence?: string }

const yesNo = (value: boolean) => (value ? "да" : "нет")

/** Detected (non-null) working conditions as label/value pairs, in display order. */
export const conditionFacts = (c: VacancyConditions): ReadonlyArray<ConditionFact> => {
  const ev = (...keys: ReadonlyArray<string>) =>
    keys.map((key) => c.evidence[key]).find((item) => item !== undefined && item !== "")
  const out: Array<ConditionFact> = []
  const add = (key: string, label: string, value: string | null, evidence?: string) => {
    if (value !== null) out.push({ key, label, value, ...(evidence ? { evidence } : {}) })
  }
  add(
    "probation",
    "Испытательный срок",
    c.probation === null
      ? null
      : c.probation
        ? c.probationMonths === null
          ? "есть"
          : `${c.probationMonths} мес.`
        : "нет",
    ev("probation", "probationMonths")
  )
  add(
    "probationPaid",
    "Оплата испытательного",
    c.probationPaid === null ? null : c.probationPaid ? "оплачивается" : "не оплачивается",
    ev("probationPaid", "probation")
  )
  add("onCall", "Дежурства", c.onCall === null ? null : yesNo(c.onCall), ev("onCall"))
  add("overtime", "Переработки", c.overtime === null ? null : overtimeLabel(c.overtime), ev("overtime"))
  add(
    "businessTrips",
    "Командировки",
    c.businessTrips === null ? null : businessTripsLabel(c.businessTrips, c.businessTripsPercent),
    ev("businessTrips", "businessTripsPercent")
  )
  add(
    "english",
    "Английский",
    c.englishLevel === null && c.englishRequired === null
      ? null
      : [c.englishLevel, c.englishRequired === null ? null : c.englishRequired ? "обязателен" : "не обязателен"]
          .filter((part): part is string => part !== null)
          .join(", "),
    ev("english", "englishLevel", "englishRequired")
  )
  add("testTask", "Тестовое задание", c.testTask === null ? null : testTaskLabel(c.testTask), ev("testTask"))
  add(
    "interviewStages",
    "Этапов собеседования",
    c.interviewStages === null ? null : String(c.interviewStages),
    ev("interviewStages")
  )
  add(
    "officialEmployment",
    "Оформление по ТК",
    c.officialEmployment === null ? null : yesNo(c.officialEmployment),
    ev("officialEmployment")
  )
  add(
    "citizenship",
    "Гражданство",
    c.citizenshipRequired === null ? null : c.citizenshipRequired ? "требуется" : "не требуется",
    ev("citizenshipRequired", "citizenship")
  )
  add(
    "vacation",
    "Отпуск",
    c.vacationDays === null ? null : `${c.vacationDays} дн.`,
    ev("vacationDays", "vacation")
  )
  add(
    "sickLeave",
    "Больничный",
    c.sickLeavePaid === null ? null : c.sickLeavePaid ? "оплачивается" : "не оплачивается",
    ev("sickLeavePaid", "sickLeave")
  )
  return out
}

const NUMBER_WORDS: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7
}

/** hh schedule codes ("FIVE_ON_TWO_OFF", "HOURS_8") as short Russian text ("5/2", "8 ч"). */
export const scheduleCodeLabel = (code: string): string => {
  const days = /^([A-Z]+)_ON_([A-Z]+)_OFF$/.exec(code)
  if (days) {
    const on = NUMBER_WORDS[days[1]!]
    const off = NUMBER_WORDS[days[2]!]
    if (on !== undefined && off !== undefined) return `${on}/${off}`
  }
  const hours = /^HOURS_(\d+)$/.exec(code)
  if (hours) return `${hours[1]} ч`
  if (code === "FLEXIBLE") return "гибкий график"
  if (code === "WEEKEND_ONLY") return "только выходные"
  return code
}
