import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { VacancyAnalysisFacts } from "@otbor/contract"
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_QUESTIONS,
  ANALYSIS_THRESHOLD,
  RawAnswers,
  buildAnalysisState,
  detectVacancyTextFacts,
  interpretAnswers,
  mergeTextFacts,
  type RawAnswers as RawAnswersType
} from "../src/index.ts"

const noul = (p: number) => ({ type: "noul" as const, noul: p })
const choice = (value: string, confidence: number) => ({
  type: "choice" as const,
  choice: value,
  confidence,
  probabilities: { [value]: confidence }
})

/** A recorded-looking answer set for a DevOps vacancy at a product company. */
const devops: RawAnswersType = {
  is_it_role: noul(0.99),
  role: choice("devops", 0.97),
  title_level: choice("senior", 0.93),
  required_level: choice("senior", 0.86),
  years_min: { type: "score", score: 4.8, confidence: 0.7 },
  company_type: choice("product", 0.91),
  work_mode: choice("remote", 0.95),
  employment: choice("unspecified", 0.6),
  req_cover_letter: choice("required", 0.94),
  req_repo: choice("not_mentioned", 0.9),
  req_portfolio: choice("preferred", 0.82),
  req_answers_in_reply: choice("not_mentioned", 0.5),
  test_task: choice("unpaid", 0.88),
  english: choice("preferred", 0.85),
  manages_people: noul(0.04),
  on_call: noul(0.03),
  night_or_weekend: noul(0.5),
  overtime: noul(0.1),
  business_trips: noul(0.19),
  probation: noul(0.97),
  probation_unpaid_or_reduced: noul(0.02),
  redflag_stress: noul(0.9),
  redflag_scam: noul(0.001)
}

const NONE = interpretAnswers({}, { threshold: ANALYSIS_THRESHOLD })

describe("catalog", () => {
  test("is versioned and has no stack questions", () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe("a4")
    expect(ANALYSIS_THRESHOLD).toBe(0.8)
    expect(Object.keys(ANALYSIS_QUESTIONS).some((id) => id.startsWith("stack_"))).toBe(false)
  })

  test("every choice question offers only options the facts schema accepts", () => {
    const facts = interpretAnswers({}, { threshold: 0.8 })
    expect(Schema.is(VacancyAnalysisFacts)(facts)).toBe(true)
    for (const [id, question] of Object.entries(ANALYSIS_QUESTIONS)) {
      if (question.type === "choice") expect(Object.keys(question.criteria).length).toBeGreaterThan(1)
      expect(typeof id).toBe("string")
    }
  })
})

describe("buildAnalysisState", () => {
  test("has the exact keys the model is prompted with and no site url, logo or badges", () => {
    const state = buildAnalysisState({
      title: "DevOps инженер",
      areaName: "Москва",
      salaryFrom: 200000,
      salaryTo: null,
      salaryCurrency: "RUR",
      workFormats: ["REMOTE"],
      experienceCode: "between3And6",
      descriptionText: "Текст",
      employer: {
        name: "Acme",
        category: "employer",
        sizeCategory: "large",
        address: "Москва",
        accreditedIt: true,
        industries: ["IT"],
        descriptionText: "О нас"
      }
    })
    expect(state).toEqual({
      title: "DevOps инженер",
      employer: {
        name: "Acme",
        kind: "employer",
        size: "large",
        city: "Москва",
        it_accredited: true,
        industries: ["IT"],
        about: "О нас"
      },
      city: "Москва",
      salary: [200000, null, "RUR"],
      work_formats: ["REMOTE"],
      experience: "between3And6",
      description: "Текст"
    })
    expect(JSON.stringify(state)).not.toMatch(/logo|site|badge/i)
  })

  test("a vacancy without an employer still yields a stable shape", () => {
    const state = buildAnalysisState({
      title: "x",
      areaName: null,
      salaryFrom: null,
      salaryTo: null,
      salaryCurrency: null,
      workFormats: null,
      experienceCode: null,
      descriptionText: null,
      employer: null
    })
    expect(state.employer).toEqual({
      name: null,
      kind: null,
      size: null,
      city: null,
      it_accredited: null,
      industries: [],
      about: null
    })
    expect(state.work_formats).toEqual([])
  })
})

describe("RawAnswers", () => {
  test("decodes a server response", () => {
    const decoded = Schema.decodeUnknownSync(RawAnswers)({
      role: { type: "choice", choice: "devops", confidence: 0.97, probabilities: { devops: 0.97 } },
      overtime: { type: "noul", noul: 0.03 },
      years_min: { type: "score", score: 2.8, confidence: 0.7 }
    })
    expect(Object.keys(decoded)).toEqual(["role", "overtime", "years_min"])
  })
})

describe("interpretAnswers", () => {
  const facts = interpretAnswers(devops, { threshold: 0.8 })

  test("noul: yes at or above the threshold, no at or below 1 - threshold, else unknown", () => {
    expect(facts.isIt).toEqual({ value: true, confidence: 0.99 })
    expect(facts.probation).toEqual({ value: true, confidence: 0.97 })
    expect(facts.onCall).toEqual({ value: false, confidence: 0.97 })
    expect(facts.overtime).toEqual({ value: false, confidence: 0.9 })
    expect(facts.businessTrips).toEqual({ value: false, confidence: 0.81 })
    expect(facts.nightOrWeekend).toBeNull()
    // unanswered
    expect(facts.bonus).toBeNull()
  })

  test("noul boundaries are inclusive", () => {
    const at = interpretAnswers({ on_call: noul(0.8), overtime: noul(0.2) }, { threshold: 0.8 })
    expect(at.onCall?.value).toBe(true)
    expect(at.overtime?.value).toBe(false)
    const under = interpretAnswers({ on_call: noul(0.79), overtime: noul(0.21) }, { threshold: 0.8 })
    expect(under.onCall).toBeNull()
    expect(under.overtime).toBeNull()
  })

  test("choice: top option only when its confidence reaches the threshold", () => {
    expect(facts.role).toEqual({ value: "devops", confidence: 0.97 })
    expect(facts.coverLetter).toEqual({ value: "required", confidence: 0.94 })
    expect(facts.employment).toBeNull() // 0.6
    expect(facts.answersInReply).toBeNull() // 0.5
  })

  test("a lower threshold exposes more facts from the same raw answers", () => {
    const loose = interpretAnswers(devops, { threshold: 0.5 })
    expect(loose.employment).toEqual({ value: "unspecified", confidence: 0.6 })
  })

  test("the explicit unknown option and foreign options read as unknown", () => {
    const f = interpretAnswers(
      { title_level: choice("unknown", 0.99), company_type: choice("unknown", 0.95), role: choice("wizard", 0.99) },
      { threshold: 0.8 }
    )
    expect(f.titleLevel).toBeNull()
    expect(f.companyType).toBeNull()
    expect(f.role).toBeNull()
  })

  test("score keeps the number with its confidence", () => {
    expect(facts.yearsMin).toEqual({ value: 4.8, confidence: 0.7 })
  })

  test("a mismatched answer type is ignored", () => {
    const f = interpretAnswers({ role: noul(0.9), overtime: choice("yes", 0.9) }, { threshold: 0.8 })
    expect(f.role).toBeNull()
    expect(f.overtime).toBeNull()
  })

  test("red flags are nested", () => {
    expect(facts.redFlags.stress).toEqual({ value: true, confidence: 0.9 })
    expect(facts.redFlags.scam).toEqual({ value: false, confidence: 0.999 })
    expect(facts.redFlags.discrimination).toBeNull()
  })

  test("employer category agency wins over the model", () => {
    const outsource = { company_type: choice("product", 0.99) }
    expect(interpretAnswers(outsource, { threshold: 0.8, employerCategory: "agency" }).companyType).toEqual({
      value: "recruiter",
      confidence: 1
    })
    expect(interpretAnswers({}, { threshold: 0.8, employerCategory: "agency" }).companyType?.value).toBe(
      "recruiter"
    )
    expect(interpretAnswers(outsource, { threshold: 0.8, employerCategory: "employer" }).companyType?.value).toBe(
      "product"
    )
  })

  test("output validates against the contract schema", () => {
    expect(Schema.is(VacancyAnalysisFacts)(facts)).toBe(true)
    expect(Schema.is(VacancyAnalysisFacts)(NONE)).toBe(true)
  })
})

describe("mergeTextFacts", () => {
  const merge = (text: string, raw: RawAnswersType, threshold = 0.8) =>
    mergeTextFacts(detectVacancyTextFacts(text), interpretAnswers(raw, { threshold }))

  test("null analysis leaves the regex facts untouched", () => {
    const regex = detectVacancyTextFacts("Сопроводительное письмо обязательно.")
    expect(mergeTextFacts(regex, null)).toBe(regex)
  })

  test("all-unknown analysis changes nothing", () => {
    const regex = detectVacancyTextFacts("Сопроводительное письмо обязательно. Тестовое задание оплачивается.")
    expect(mergeTextFacts(regex, NONE)).toEqual(regex)
  })

  test("the model finds a cover letter request the regex missed", () => {
    const merged = merge("Расскажите о себе и своих проектах.", { req_cover_letter: choice("required", 0.95) })
    expect(merged.coverLetter.requested).toBe(true)
    expect(merged.coverLetter.evidence).toBe("model: required (0.95)")
  })

  test("regex evidence is kept when the model agrees", () => {
    const merged = merge("Сопроводительное письмо обязательно.", { req_cover_letter: choice("preferred", 0.9) })
    expect(merged.coverLetter).toEqual({ requested: true, evidence: "Сопроводительное письмо обязательно." })
  })

  test("a confident not_mentioned drops a regex cover letter request", () => {
    const merged = merge("Сопроводительное письмо обязательно.", { req_cover_letter: choice("not_mentioned", 0.93) })
    expect(merged.coverLetter).toEqual({ requested: false, evidence: null })
  })

  test("low confidence does not override the regex", () => {
    const merged = merge("Сопроводительное письмо обязательно.", { req_cover_letter: choice("not_mentioned", 0.6) })
    expect(merged.coverLetter.requested).toBe(true)
  })

  test("repo and portfolio: GitHub Actions noise is removed, a real request is added", () => {
    const noisy = detectVacancyTextFacts("Стек: GitHub Actions, GitLab CI, Docker.\nПри отклике приложите ссылку на GitHub.")
    expect(noisy.applicationRequests.some((request) => request.code === "github")).toBe(true)
    const dropped = mergeTextFacts(
      noisy,
      interpretAnswers({ req_repo: choice("not_mentioned", 0.95) }, { threshold: 0.8 })
    )
    expect(dropped.applicationRequests.some((request) => request.code === "github")).toBe(false)

    const added = merge("Условия отличные.", {
      req_repo: choice("required", 0.9),
      req_portfolio: choice("preferred", 0.85)
    })
    expect(added.applicationRequests.map((request) => request.code)).toEqual(["github", "portfolio"])
    expect(added.applicationRequests[0]!.evidence).toBe("model: required (0.90)")
  })

  test("answers in reply maps to about_me", () => {
    const merged = merge("Ответьте на вопросы ниже.", { req_answers_in_reply: choice("required", 0.9) })
    expect(merged.applicationRequests).toEqual([{ code: "about_me", evidence: "model: required (0.90)" }])
  })

  test("conditions: on-call noise is erased, the model creates conditions from nothing", () => {
    const regex = detectVacancyTextFacts("Нужен опыт дежурство по графику.")
    expect(regex.conditions?.onCall).toBe(true)
    const erased = mergeTextFacts(regex, interpretAnswers({ on_call: noul(0.02) }, { threshold: 0.8 }))
    expect(erased.conditions?.onCall).toBeNull()
    expect(erased.conditions?.evidence.onCall).toBeUndefined()

    const created = merge("Привет.", { on_call: noul(0.95), overtime: noul(0.9) })
    expect(created.conditions?.onCall).toBe(true)
    expect(created.conditions?.overtime).toBe("possible")
    expect(created.conditions?.evidence.onCall).toBe("model: true (0.95)")
    expect(created.redFlags.map((flag) => flag.code)).toContain("overtime")
  })

  test("an all-null conditions result collapses back to null", () => {
    expect(merge("Привет.", { on_call: noul(0.02) }).conditions).toBeNull()
  })

  test("test task: unpaid sets the flag, paid clears it, unspecified keeps a stated regex value", () => {
    const unpaid = merge("Привет.", { test_task: choice("unpaid", 0.9) })
    expect(unpaid.conditions?.testTask).toBe("unpaid")
    expect(unpaid.redFlags.map((flag) => flag.code)).toContain("unpaid_test")

    const regexUnpaid = detectVacancyTextFacts("Тестовое задание не оплачивается.")
    expect(regexUnpaid.conditions?.testTask).toBe("unpaid")
    const paid = mergeTextFacts(regexUnpaid, interpretAnswers({ test_task: choice("paid", 0.9) }, { threshold: 0.8 }))
    expect(paid.conditions?.testTask).toBe("paid")
    expect(paid.redFlags.map((flag) => flag.code)).not.toContain("unpaid_test")

    const kept = mergeTextFacts(
      regexUnpaid,
      interpretAnswers({ test_task: choice("unspecified", 0.9) }, { threshold: 0.8 })
    )
    expect(kept.conditions?.testTask).toBe("unpaid")
    expect(merge("Привет.", { test_task: choice("unspecified", 0.9) }).conditions?.testTask).toBe("possible")
    expect(merge("Привет.", { test_task: choice("none", 0.9) }).conditions?.testTask).toBe("none")
  })

  test("night or weekend adds one flag, a confident no removes both", () => {
    const added = merge("Привет.", { night_or_weekend: noul(0.9) })
    expect(added.redFlags.map((flag) => flag.code)).toEqual(["night_shifts"])
    const regex = detectVacancyTextFacts("Работа в ночные смены и в выходные.")
    expect(regex.redFlags.length).toBeGreaterThan(0)
    const cleared = mergeTextFacts(regex, interpretAnswers({ night_or_weekend: noul(0.05) }, { threshold: 0.8 }))
    expect(cleared.redFlags.some((flag) => flag.code === "night_shifts" || flag.code === "weekend_work")).toBe(
      false
    )
  })

  test("english, employment, probation and the red flags map onto conditions", () => {
    const merged = merge("Привет.", {
      english: choice("required", 0.9),
      employment: choice("labor_code", 0.9),
      probation: noul(0.95),
      probation_unpaid_or_reduced: noul(0.9),
      redflag_stress: noul(0.9),
      redflag_multitask: noul(0.92),
      redflag_scam: noul(0.9),
      redflag_discrimination: noul(0.9),
      citizenship_required: noul(0.9),
      business_trips: noul(0.9)
    })
    expect(merged.conditions).toMatchObject({
      englishRequired: true,
      officialEmployment: true,
      probation: true,
      probationPaid: false,
      citizenshipRequired: true,
      businessTrips: "possible"
    })
    expect(merged.redFlags.map((flag) => flag.code)).toEqual([
      "job_scam",
      "probation_unpaid",
      "stress",
      "multitasking",
      "age_limit"
    ])
  })

  test("the merged result keeps the VacancyTextFacts shape", () => {
    const merged = merge("Расскажите о себе. Тестовое задание.", devops)
    expect(Object.keys(merged).sort()).toEqual(["applicationRequests", "conditions", "coverLetter", "redFlags"])
    expect(merged.conditions).not.toBeNull()
    expect(Object.keys(merged.conditions!).sort()).toEqual(
      Object.keys(detectVacancyTextFacts("Тестовое задание.").conditions!).sort()
    )
  })
})
