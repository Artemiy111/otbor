import { describe, expect, test } from "bun:test"
import type { Seniority } from "@otbor/contract"
import { analysisSeniority, seniorityOfLevel, type DecisionAnalysis } from "../src/analysis/decision.ts"
import { DEFAULT_APPLY_SETTINGS } from "../src/applyFilter.ts"
import { decide } from "../src/decision.ts"
import type { VacancySignal } from "../src/decision.ts"

const vacancy = (seniority: Seniority = "unknown"): VacancySignal => ({
  id: "v1",
  title: "Инженер инфраструктуры",
  archived: false,
  salaryFrom: 300_000,
  salaryTo: 400_000,
  salaryCurrency: "RUB",
  workFormats: ["remote"],
  seniority,
  publishedAt: "2026-10-31T12:00:00.000Z",
  employerId: "e1",
  employerName: "Acme",
  skills: [],
  descriptionText: ""
})

const analysis = (overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis => ({
  isIt: { value: true, confidence: 0.98 },
  role: { value: "devops", confidence: 0.97 },
  requiredLevel: null,
  ...overrides
})

const run = (a: DecisionAnalysis | null, options: { seniority?: Seniority } = {}) =>
  decide({
    vacancy: vacancy(options.seniority),
    filter: { passed: true, failed: [] },
    settings: DEFAULT_APPLY_SETTINGS,
    keywords: [],
    boostWeight: 0,
    blocks: { applied: false, hasTest: false, testRequired: false },
    analysis: a,
    now: new Date("2026-11-01T12:00:00.000Z")
  })

describe("seniority from the analysis", () => {
  test("maps analysis levels onto the policy seniority", () => {
    expect(seniorityOfLevel("intern")).toBe("junior")
    expect(seniorityOfLevel("junior")).toBe("junior")
    expect(seniorityOfLevel("middle")).toBe("middle")
    expect(seniorityOfLevel("senior")).toBe("senior")
    expect(seniorityOfLevel("staff")).toBe("senior")
    expect(seniorityOfLevel("tech_lead")).toBe("lead")
    expect(seniorityOfLevel("team_lead")).toBe("lead")
    expect(seniorityOfLevel("head")).toBe("lead")
  })

  test("only fills an unknown seniority and only when confident", () => {
    const a = analysis({ requiredLevel: { value: "staff", confidence: 0.9 } })
    expect(analysisSeniority("unknown", a)?.seniority).toBe("senior")
    expect(analysisSeniority("middle", a)).toBeNull()
    expect(analysisSeniority("unknown", analysis({ requiredLevel: { value: "staff", confidence: 0.5 } }))).toBeNull()
    expect(analysisSeniority("unknown", null)).toBeNull()
  })

  test("an analysis level fills an unknown seniority and is reported", () => {
    const passed = run(analysis({ requiredLevel: { value: "senior", confidence: 0.95 } }))
    expect(passed.verdict).toBe("apply")
    expect(passed.reasons.find((r) => r.code === "seniority")?.detail).toBe("analysis: senior -> senior (0.95)")
  })

  test("a stored seniority wins over the analysis", () => {
    const junior = analysis({ requiredLevel: { value: "intern", confidence: 0.95 } })
    const result = run(junior, { seniority: "senior" })
    expect(result.verdict).toBe("apply")
    expect(result.reasons.some((r) => r.code === "seniority")).toBe(false)
  })
})
