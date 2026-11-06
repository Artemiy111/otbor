import type {
  ApplicationRequest,
  ApplicationRequestCode,
  RedFlag,
  RedFlagCode,
  VacancyAnalysisFacts,
  VacancyConditions,
  VacancyTextFacts
} from "@otbor/contract"
import { RED_FLAG_ORDER } from "../vacancy-facts.ts"

/**
 * Folds the model's facts into the regex detectors' `VacancyTextFacts`, so every
 * consumer of the old shape (decision blockers, kit hints, the web page) gets
 * the better answer without changing. Where the analysis is confident it wins,
 * in both directions: it adds requests the regex missed and drops the ones it
 * fired on noise ("GitHub Actions" as a repo request, "function calling" as
 * on-call). Where it is unknown, the regex result stays. Regex evidence is kept
 * when both agree; model-only facts carry a short `model: ...` marker.
 */

type Fact<A> = { readonly value: A; readonly confidence: number } | null
type RequestFact = VacancyAnalysisFacts["repo"]

const marker = (fact: { readonly value: unknown; readonly confidence: number }): string =>
  `model: ${String(fact.value)} (${fact.confidence.toFixed(2)})`

const REQUEST_ORDER: ReadonlyArray<ApplicationRequestCode> = [
  "github",
  "portfolio",
  "code_samples",
  "about_me",
  "motivation"
]

const emptyConditions = (): VacancyConditions => ({
  probation: null,
  probationMonths: null,
  probationPaid: null,
  onCall: null,
  overtime: null,
  businessTrips: null,
  businessTripsPercent: null,
  englishLevel: null,
  englishRequired: null,
  testTask: null,
  interviewStages: null,
  officialEmployment: null,
  citizenshipRequired: null,
  vacationDays: null,
  sickLeavePaid: null,
  evidence: {}
})

const isEmpty = (conditions: VacancyConditions): boolean =>
  Object.entries(conditions).every(([key, value]) =>
    key === "evidence" ? Object.keys(value as object).length === 0 : value === null
  )

/** yes sets true; a confident no only erases a regex `true` (noise), never invents `false`. */
const refineBool = (current: boolean | null, fact: Fact<boolean>): boolean | null =>
  fact === null ? current : fact.value ? true : current === true ? null : current

export const mergeTextFacts = (
  regexFacts: VacancyTextFacts,
  analysis: VacancyAnalysisFacts | null
): VacancyTextFacts => {
  if (analysis === null) return regexFacts

  /* ------------------------------ cover letter ----------------------------- */

  const letter = analysis.coverLetter
  const coverLetter =
    letter === null
      ? regexFacts.coverLetter
      : letter.value === "not_mentioned"
        ? { requested: false, evidence: null }
        : {
            requested: true,
            evidence: regexFacts.coverLetter.requested
              ? (regexFacts.coverLetter.evidence ?? marker(letter))
              : marker(letter)
          }

  /* --------------------------- application requests ------------------------- */

  const requests = new Map<ApplicationRequestCode, ApplicationRequest>(
    regexFacts.applicationRequests.map((request) => [request.code, request])
  )
  const applyRequest = (fact: RequestFact, codes: ReadonlyArray<ApplicationRequestCode>): void => {
    if (fact === null) return
    if (fact.value === "not_mentioned") {
      for (const code of codes) requests.delete(code)
      return
    }
    if (codes.some((code) => requests.has(code))) return
    requests.set(codes[0]!, { code: codes[0]!, evidence: marker(fact) })
  }
  applyRequest(analysis.repo, ["github", "code_samples"])
  applyRequest(analysis.portfolio, ["portfolio"])
  applyRequest(analysis.answersInReply, ["about_me"])
  const applicationRequests = REQUEST_ORDER.flatMap((code) => {
    const request = requests.get(code)
    return request === undefined ? [] : [request]
  })

  /* -------------------------------- conditions ------------------------------ */

  const base = regexFacts.conditions ?? emptyConditions()
  const next: { -readonly [K in keyof VacancyConditions]: VacancyConditions[K] } = {
    ...base,
    evidence: { ...base.evidence }
  }
  const evidence = next.evidence as Record<string, string>
  const touch = (key: string, before: unknown, after: unknown, fact: Fact<unknown>): void => {
    if (fact === null || before === after) return
    if (after === null) delete evidence[key]
    else evidence[key] = marker(fact)
  }

  next.onCall = refineBool(base.onCall, analysis.onCall)
  touch("onCall", base.onCall, next.onCall, analysis.onCall)

  next.probation = refineBool(base.probation, analysis.probation)
  touch("probation", base.probation, next.probation, analysis.probation)

  next.citizenshipRequired = refineBool(base.citizenshipRequired, analysis.citizenshipRequired)
  touch("citizenship", base.citizenshipRequired, next.citizenshipRequired, analysis.citizenshipRequired)

  const unpaidProbation = analysis.probationUnpaidOrReduced
  if (unpaidProbation !== null) {
    next.probationPaid = unpaidProbation.value
      ? false
      : base.probationPaid === false
        ? null
        : base.probationPaid
    touch("probationPaid", base.probationPaid, next.probationPaid, unpaidProbation)
  }

  const overtime = analysis.overtime
  if (overtime !== null) {
    const soft = base.overtime === "possible" || base.overtime === "unpaid"
    next.overtime = overtime.value
      ? base.overtime === "none" || base.overtime === null
        ? "possible"
        : base.overtime
      : soft
        ? null
        : base.overtime
    touch("overtime", base.overtime, next.overtime, overtime)
  }

  const trips = analysis.businessTrips
  if (trips !== null) {
    const present = base.businessTrips !== null && base.businessTrips !== "none"
    next.businessTrips = trips.value
      ? present
        ? base.businessTrips
        : "possible"
      : present
        ? null
        : base.businessTrips
    if (next.businessTrips === null) next.businessTripsPercent = null
    touch("businessTrips", base.businessTrips, next.businessTrips, trips)
  }

  const task = analysis.testTask
  if (task !== null) {
    const stated = base.testTask === "paid" || base.testTask === "unpaid"
    next.testTask = task.value === "unspecified" ? (stated ? base.testTask : "possible") : task.value
    touch("testTask", base.testTask, next.testTask, task)
  }

  const english = analysis.english
  if (english !== null) {
    if (english.value === "required") next.englishRequired = true
    else if (english.value === "preferred") next.englishRequired = false
    else {
      next.englishRequired = null
      next.englishLevel = null
    }
    if (english.value === "not_mentioned") delete evidence.english
    else if (base.englishRequired !== next.englishRequired) evidence.english = marker(english)
  }

  const employment = analysis.employment
  if (employment !== null && employment.value !== "unspecified") {
    next.officialEmployment = employment.value === "labor_code"
    touch("officialEmployment", base.officialEmployment, next.officialEmployment, employment)
  }

  const conditions = regexFacts.conditions === null && isEmpty(next) ? null : next

  /* -------------------------------- red flags -------------------------------- */

  const flags = new Map<RedFlagCode, RedFlag>(regexFacts.redFlags.map((flag) => [flag.code, flag]))
  const sync = (codes: ReadonlyArray<RedFlagCode>, fact: Fact<unknown>, present: boolean): void => {
    if (fact === null) return
    if (!present) {
      for (const code of codes) flags.delete(code)
      return
    }
    if (codes.some((code) => flags.has(code))) return
    flags.set(codes[0]!, { code: codes[0]!, evidence: marker(fact) })
  }
  const yes = (fact: Fact<boolean>): boolean => fact?.value === true

  sync(["stress"], analysis.redFlags.stress, yes(analysis.redFlags.stress))
  sync(["multitasking"], analysis.redFlags.multitask, yes(analysis.redFlags.multitask))
  sync(["job_scam"], analysis.redFlags.scam, yes(analysis.redFlags.scam))
  sync(["night_shifts", "weekend_work"], analysis.nightOrWeekend, yes(analysis.nightOrWeekend))
  sync(["age_limit", "gender_limit"], analysis.redFlags.discrimination, yes(analysis.redFlags.discrimination))
  sync(["probation_unpaid"], analysis.probationUnpaidOrReduced, yes(analysis.probationUnpaidOrReduced))
  sync(["overtime"], analysis.overtime, next.overtime === "possible" || next.overtime === "unpaid")
  sync(["unpaid_test"], analysis.testTask, next.testTask === "unpaid")

  const redFlags = RED_FLAG_ORDER.flatMap((code) => {
    const flag = flags.get(code)
    return flag === undefined ? [] : [flag]
  })

  return { coverLetter, applicationRequests, conditions, redFlags, salary: regexFacts.salary ?? null }
}
