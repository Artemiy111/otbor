import { describe, expect, test } from "bun:test"
import type { FitJudgement } from "@otbor/contract"
import { Effect, Exit } from "effect"
import {
  buildFitPrompt,
  currentFitVersions,
  digestResume,
  FIT_PROMPT_VERSION,
  fitVerdictFor,
  isFitJudgementCurrent,
  parseFitAnswer,
  stripContacts,
  type FitJudgementFingerprint,
  type FitResumeInput,
  type FitVacancyInput
} from "../src/index.ts"

const vacancy: FitVacancyInput = {
  title: "Senior DevOps Engineer",
  employerName: "Acme",
  salaryFrom: 300_000,
  salaryTo: 400_000,
  salaryCurrency: "RUR",
  workFormats: ["remote"],
  seniority: "senior",
  skills: ["Kubernetes", "Terraform", "kubernetes"],
  descriptionText: "Нужен опыт Kubernetes.\n\n\n\nПишите на hr@acme.example"
}

const resume: FitResumeInput = {
  title: "DevOps инженер",
  text: [
    "Иван Иванов",
    "Телефон: +7 (916) 123-45-67",
    "Email: ivan.ivanov@example.com",
    "Telegram: @ivan_dev, https://t.me/ivan_dev",
    "GitHub: https://github.com/ivan",
    "Работал в 2018 - 2022 в Рога и Копыта, поднял Kubernetes кластер.",
    "Можно написать на ivan@mail.ru или позвонить 89161234567."
  ].join("\n"),
  about: "Связь: ivan@mail.ru, https://linkedin.com/in/ivan",
  skills: ["Kubernetes", "Terraform"],
  salaryAmount: 250_000,
  salaryCurrency: "RUR",
  enrichment: {
    comment: "Жду предложений, мой tg @ivan_dev",
    salaryMin: 280_000,
    salaryExpectation: 350_000,
    currency: "RUR"
  }
}

describe("stripContacts", () => {
  test("removes e-mail, phones, handles and links", () => {
    const out = stripContacts(
      "mail a.b@c.io, tel +7 916 123 45 67 / 8 (916) 123-45-67, tg @some_user, see https://t.me/some_user and www.example.com/x"
    )
    expect(out).not.toMatch(/c\.io|916|some_user|example\.com/)
    expect(out).toContain("[email]")
    expect(out).toContain("[phone]")
    expect(out).toContain("[link]")
  })

  test("leaves salary figures and date ranges alone", () => {
    const out = stripContacts("Зарплата 250 000 - 300 000 руб, опыт 2018 - 2022, 5 лет")
    expect(out).toBe("Зарплата 250 000 - 300 000 руб, опыт 2018 - 2022, 5 лет")
  })

  test("drops lines that exist only to hold contacts", () => {
    expect(stripContacts("Навыки: Go\nКонтакты: что угодно\nОпыт: 5 лет")).not.toContain("что угодно")
  })
})

describe("buildFitPrompt", () => {
  const prompt = buildFitPrompt({ vacancy, resume })

  test("never contains the candidate's contacts", () => {
    const everything = `${prompt.system}\n${prompt.user}`
    for (const secret of [
      "ivan.ivanov@example.com",
      "ivan@mail.ru",
      "916",
      "ivan_dev",
      "github.com/ivan",
      "linkedin.com"
    ]) {
      expect(everything).not.toContain(secret)
    }
    // the substance survives
    expect(prompt.user).toContain("поднял Kubernetes кластер")
    expect(prompt.user).toContain("2018 - 2022")
  })

  test("carries a compact vacancy digest and the salary expectation", () => {
    expect(prompt.user).toContain("Title: Senior DevOps Engineer")
    expect(prompt.user).toContain("Employer: Acme")
    expect(prompt.user).toContain("Salary: 300000-400000 RUR")
    expect(prompt.user).toContain("Work formats: remote")
    expect(prompt.user).toContain("Seniority: senior")
    // duplicate skills (case-insensitive) collapse
    expect(prompt.user).toContain("Skills: Kubernetes, Terraform")
    expect(prompt.user).toContain("expects 350000 RUR, minimum 280000 RUR")
    expect(prompt.user).not.toMatch(/\n{3,}/)
  })

  test("trims a long description and declares the version and schema", () => {
    const long = buildFitPrompt({
      vacancy: { ...vacancy, descriptionText: "x".repeat(20_000) },
      resume
    })
    expect(long.user.length).toBeLessThan(12_000)
    expect(long.promptVersion).toBe(FIT_PROMPT_VERSION)
    expect(JSON.stringify(long.jsonSchema)).toContain("disqualifiers")
  })

  test("treats vacancy and resume as data", () => {
    expect(prompt.system).toContain("untrusted data")
    expect(prompt.user.indexOf("<vacancy>")).toBeLessThan(prompt.user.indexOf("<resume>"))
  })

  test("digest changes only when something the model sees changes", () => {
    const a = digestResume(resume)
    expect(digestResume({ ...resume })).toEqual(a)
    expect(digestResume({ ...resume, text: `${resume.text}\nновый опыт` })).not.toEqual(a)
    // a different phone number is stripped, so the digest (and hash) is identical
    expect(digestResume({ ...resume, about: "Связь: other@mail.ru, https://linkedin.com/in/x" })).toEqual(a)
  })
})

describe("parseFitAnswer", () => {
  const good: FitJudgement = {
    fit: 74,
    confidence: 0.7,
    verdict: "ok",
    reasons: ["Kubernetes в резюме"],
    disqualifiers: ["нет Terraform"],
    quotes: ["опыт Kubernetes"]
  }
  const parse = (text: string) => Effect.runSyncExit(parseFitAnswer(text))
  const value = (text: string) => {
    const exit = parse(text)
    if (!Exit.isSuccess(exit)) throw new Error("expected success")
    return exit.value
  }
  const message = (text: string) => {
    const exit = parse(text)
    if (!Exit.isFailure(exit)) throw new Error("expected failure")
    return JSON.stringify(exit.cause)
  }

  test("plain JSON", () => {
    expect(value(JSON.stringify(good))).toEqual(good)
  })

  test("code fence with language tag", () => {
    expect(value(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``)).toEqual(good)
  })

  test("prose around a fence and around bare JSON", () => {
    expect(value(`Вот оценка:\n\`\`\`\n${JSON.stringify(good, null, 2)}\n\`\`\`\nГотово.`)).toEqual(good)
    expect(value(`Ответ: ${JSON.stringify(good)} — вот так.`)).toEqual(good)
  })

  test("braces inside strings do not confuse the extractor", () => {
    const tricky = { ...good, reasons: ["фигурные { скобки } в тексте"] }
    expect(value(`текст ${JSON.stringify(tricky)} хвост`)).toEqual(tricky)
  })

  test("fitScore alias, fractional fit rounds, missing lists default to empty", () => {
    const out = value(JSON.stringify({ fitScore: 80.4, confidence: 1, verdict: "strong" }))
    expect(out).toEqual({
      fit: 80,
      confidence: 1,
      verdict: "strong",
      reasons: [],
      disqualifiers: [],
      quotes: []
    })
  })

  test("long lists are capped and blank items dropped", () => {
    const out = value(
      JSON.stringify({ ...good, reasons: Array.from({ length: 12 }, (_, i) => (i === 1 ? " " : `r${i}`)) })
    )
    expect(out.reasons).toHaveLength(6)
    expect(out.reasons).not.toContain("")
  })

  test.each([
    ["empty", ""],
    ["no object", "I think it is a good fit."],
    ["broken JSON", "{fit: 80,}"],
    ["array root", "[1,2,3]"],
    ["fit above 100", JSON.stringify({ ...good, fit: 140 })],
    ["negative fit", JSON.stringify({ ...good, fit: -1 })],
    ["fit as text", JSON.stringify({ ...good, fit: "high" })],
    ["confidence above 1", JSON.stringify({ ...good, confidence: 85 })],
    ["unknown verdict", JSON.stringify({ ...good, verdict: "great" })],
    ["missing verdict", JSON.stringify({ fit: 50, confidence: 0.5 })],
    ["non-string reasons", JSON.stringify({ ...good, reasons: [1, 2] })]
  ])("rejects: %s", (_, text) => {
    expect(message(text)).toContain("FitParseError")
  })
})

describe("judgement staleness", () => {
  const current = {
    contentHash: "v2",
    resumeHash: "r2",
    promptVersion: currentFitVersions.promptVersion
  }
  const fresh: FitJudgementFingerprint = {
    status: "done",
    vacancyContentHash: "v2",
    resumeHash: "r2",
    promptVersion: currentFitVersions.promptVersion
  }

  test("no judgement is not current", () => {
    expect(isFitJudgementCurrent(null, current)).toBe(false)
  })

  test("same vacancy, resume and prompt: current", () => {
    expect(isFitJudgementCurrent(fresh, current)).toBe(true)
  })

  test("changed vacancy content, resume or prompt version: stale", () => {
    expect(isFitJudgementCurrent({ ...fresh, vacancyContentHash: "v1" }, current)).toBe(false)
    expect(isFitJudgementCurrent({ ...fresh, resumeHash: "r1" }, current)).toBe(false)
    expect(isFitJudgementCurrent({ ...fresh, promptVersion: "fit-v0" }, current)).toBe(false)
  })

  test("pending and failed judgements are never current", () => {
    expect(isFitJudgementCurrent({ ...fresh, status: "pending" }, current)).toBe(false)
    expect(isFitJudgementCurrent({ ...fresh, status: "failed" }, current)).toBe(false)
  })

  test("verdict bands", () => {
    expect([95, 80, 79, 60, 59, 40, 39, 0].map(fitVerdictFor)).toEqual([
      "strong",
      "strong",
      "ok",
      "ok",
      "weak",
      "weak",
      "no",
      "no"
    ])
  })
})
