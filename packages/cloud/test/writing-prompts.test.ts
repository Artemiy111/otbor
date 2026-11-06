import { describe, expect, test } from "bun:test"
import {
  buildDraftPrompt,
  detectWritingLanguage,
  resolveEmployment,
  type DraftQuestion
} from "../src/writing/prompts.ts"

const vacancyRu = {
  title: "Ведущий DevOps инженер",
  employer: "Ромашка",
  description: "Поддерживайте Kubernetes и Terraform для платёжной платформы.",
  skills: ["Kubernetes", "Terraform"]
}

const resumeRu = "Инженер DevOps с 2018 года. Перевёл CI на GitLab."

describe("writing language detection", () => {
  test("Cyrillic text is Russian and Latin text is English", () => {
    expect(detectWritingLanguage("Пишем сопроводительное письмо")).toBe("ru")
    expect(detectWritingLanguage("We are hiring a DevOps engineer")).toBe("en")
    expect(detectWritingLanguage("")).toBe("en")
  })

  test("a little Cyrillic in a Latin text stays English", () => {
    expect(detectWritingLanguage("Kubernetes Terraform Postgres GitLab Docker и ещё")).toBe("en")
  })

  test("auto detects from the vacancy, an explicit language wins", () => {
    expect(buildDraftPrompt({ vacancy: vacancyRu, resumeText: resumeRu, coverLetter: "optional", questions: [] }).language)
      .toBe("ru")
    expect(buildDraftPrompt({ vacancy: vacancyRu, coverLetter: "optional", questions: [], language: "en" }).language)
      .toBe("en")
  })
})

describe("buildDraftPrompt questions", () => {
  const questions: ReadonlyArray<DraftQuestion> = [
    { id: "q-format", kind: "single", text: "Формат работы?", required: true, options: [{ id: "o-remote", label: "Удалённо" }] },
    { id: "q-salary", kind: "text", text: "Ожидания по зарплате?", required: true, options: [] },
    { id: "q-city", kind: "text", text: "Ваш город?", required: false, options: [] },
    { id: "q-tool", kind: "single", text: "Работали с Jira?", required: false, options: [{ id: "o-yes", label: "Да" }] },
    { id: "q-code", kind: "code", text: "Напишите функцию", required: true, options: [] }
  ]
  const prompt = buildDraftPrompt({
    vacancy: vacancyRu,
    coverLetter: "required",
    questions,
    hints: [
      { questionId: "q-salary", kind: "salary", text: "от 250000", hard: true },
      { questionId: "q-city", kind: "city", text: "Казань", hard: false },
      { questionId: "q-tool", kind: "tool_experience", optionIds: ["o-yes"], hard: false },
      { questionId: "q-format", kind: "remote", optionIds: ["o-remote"], hard: true, blockers: ["currency mismatch"] }
    ]
  })

  test("code tasks and hard-hinted questions are not sent to the model", () => {
    expect(prompt.user).not.toContain("q-code")
    expect(prompt.user).not.toContain("q-salary")
  })

  test("a blocked hint does not hide its question", () => {
    expect(prompt.user).toContain("id=q-format")
  })

  test("a soft hint is shown, the blanket tool-experience hint is not", () => {
    expect(prompt.user).toContain("hint: Казань")
    expect(prompt.user).toContain("id=q-tool")
    expect(prompt.user).not.toContain("hint: Да")
  })
})

describe("buildDraftPrompt applicant notes", () => {
  test("the enrichment reaches the prompt", () => {
    const prompt = buildDraftPrompt({
      vacancy: vacancyRu,
      coverLetter: "optional",
      questions: [],
      profile: {
        comment: "Ищу продуктовую команду",
        salaries: [{ currency: "RUB", expectation: 300000, min: 250000 }],
        faq: [{ question: "Когда вы готовы выйти на работу?", answer: "через две недели" }],
        jobs: [{ job: "acme devops", leaveReason: "закрыли проект" }]
      }
    })
    expect(prompt.user).toContain("Ищу продуктовую команду")
    expect(prompt.user).toContain("300000")
    expect(prompt.user).toContain("через две недели")
    expect(prompt.user).toContain("закрыли проект")
  })
})

describe("resolveEmployment", () => {
  const open = [{ startDate: "2022-01", endDate: null }, { startDate: "2019-01", endDate: "2021-12" }]
  const closed = [{ startDate: "2019-01", endDate: "2021-12" }]

  test("derives from the end date of the jobs", () => {
    expect(resolveEmployment(null, open)).toBe("current")
    expect(resolveEmployment(undefined, closed)).toBe("past")
    expect(resolveEmployment(null, [])).toBe("unknown")
  })

  test("the operator's override wins", () => {
    expect(resolveEmployment(false, open)).toBe("past")
    expect(resolveEmployment(true, closed)).toBe("current")
  })
})
