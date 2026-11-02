import { describe, expect, test } from "bun:test"
import {
  ANSWERS_PROMPT_VERSION,
  buildAnswersPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  COVER_LETTER_PROMPT_VERSION,
  detectWritingLanguage,
  RESUME_PROMPT_VERSION
} from "../src/writing/prompts.ts"

const vacancy = {
  title: "Senior DevOps Engineer",
  employer: "Acme Cloud",
  description: "Own Kubernetes and Terraform for a payments platform.",
  skills: ["Kubernetes", "Terraform", "Postgres"]
}

const vacancyRu = {
  title: "Ведущий DevOps инженер",
  employer: "Ромашка",
  description: "Поддерживайте Kubernetes и Terraform для платёжной платформы.",
  skills: ["Kubernetes", "Terraform"]
}

const resumeText = "DevOps engineer since 2018. Migrated CI to GitLab."
const resumeRu = "Инженер DevOps с 2018 года. Перевёл CI на GitLab."

describe("writing language detection", () => {
  test("Cyrillic text is Russian and Latin text is English", () => {
    expect(detectWritingLanguage("Пишем сопроводительное письмо")).toBe("ru")
    expect(detectWritingLanguage("We are hiring a DevOps engineer")).toBe("en")
    expect(detectWritingLanguage("")).toBe("en")
  })

  test("a little Cyrillic in a Latin text stays English", () => {
    expect(
      detectWritingLanguage("Kubernetes Terraform Postgres GitLab Docker и ещё")
    ).toBe("en")
  })

  test("auto detects from the vacancy for application-based prompts", () => {
    const letter = buildCoverLetterPrompt({ vacancy: vacancyRu, resumeText: resumeRu })
    const answers = buildAnswersPrompt({
      vacancy: vacancyRu,
      resumeText: resumeRu,
      questions: ["Почему мы?"]
    })

    expect(letter.language).toBe("ru")
    expect(answers.language).toBe("ru")
  })

  test("an explicit language wins over detection", () => {
    const letter = buildCoverLetterPrompt({
      vacancy: vacancyRu,
      resumeText: resumeRu,
      language: "en"
    })

    expect(letter.language).toBe("en")
    expect(letter.user).toContain("LANGUAGE: en")
    expect(letter.system).toContain("Do not invent")
  })
})

describe("cover letter prompt", () => {
  test("returns the system and user turns separately", () => {
    const prompt = buildCoverLetterPrompt({ vacancy, resumeText })

    expect(prompt.system.length).toBeGreaterThan(0)
    expect(prompt.user.length).toBeGreaterThan(0)
    expect(prompt.promptVersion).toBe(COVER_LETTER_PROMPT_VERSION)
    expect(prompt.system).not.toBe(prompt.user)
  })

  test("the Russian system keeps the proven no-invention, dash and greeting rules", () => {
    const prompt = buildCoverLetterPrompt({ vacancy: vacancyRu, resumeText: resumeRu })

    expect(prompt.system).toContain("Не выдумывай компании")
    expect(prompt.system).toContain("«нет в резюме»")
    expect(prompt.system).toContain("Не используй тире (—, –)")
    expect(prompt.system).toContain("Не используй Markdown")
    expect(prompt.system).toContain("Начни с приветствия")
    expect(prompt.system).toContain("Не добавляй подпись")
    expect(prompt.system).toContain("Жёсткий лимит")
    expect(prompt.user).toContain("VACANCY")
    expect(prompt.user).toContain("RESUME")
    expect(prompt.user).toContain("APPLICANT NOTES")
    expect(prompt.user).toContain("Ведущий DevOps инженер")
    expect(prompt.user).toContain(resumeRu)
    expect(prompt.user).not.toMatch(/[—–]/)
  })

  test("the English system carries the same invariants", () => {
    const prompt = buildCoverLetterPrompt({
      vacancy,
      resumeText,
      language: "en",
      tone: "calm and concrete",
      length: "short"
    })

    expect(prompt.system).toContain("Do not invent companies")
    expect(prompt.system).toContain("Never write that something is missing from the resume")
    expect(prompt.system).toContain("Do not use em or en dashes (—, –)")
    expect(prompt.system).toContain("Start with a greeting")
    expect(prompt.system).toContain("Do not add a signature")
    expect(prompt.system).toContain("Hard limit: no more than 400 characters")
    expect(prompt.user).toContain("LANGUAGE: en")
    expect(prompt.user).toContain("TONE: calm and concrete")
    expect(prompt.user).toContain("Title: Senior DevOps Engineer")
    expect(prompt.user).toContain("Employer: Acme Cloud")
    expect(prompt.user).toContain("Kubernetes, Terraform, Postgres")
    expect(prompt.user).toContain(resumeText)
    expect(prompt.user).toContain("APPLICANT NOTES")
    expect(prompt.user).not.toMatch(/[—–]/)
  })

  test("defaults to a businesslike tone and a medium letter", () => {
    const prompt = buildCoverLetterPrompt({ vacancy, language: "en" })

    expect(prompt.user).toContain("TONE: businesslike, calm, no slang")
    expect(prompt.user).toContain("LENGTH: 280-700 characters")
    expect(prompt.user).toContain("no resume text is available")
  })

  test("facts and gaps are optional blocks", () => {
    const withFacts = buildCoverLetterPrompt({
      vacancy,
      resumeText,
      language: "en",
      facts: ["Migrated CI to GitLab"],
      gaps: ["Kubernetes in production"],
      notes: "Ready to work remotely."
    })
    const withoutFacts = buildCoverLetterPrompt({ vacancy, resumeText, language: "en" })

    expect(withFacts.user).toContain("CONFIRMED FACTS")
    expect(withFacts.user).toContain("- Migrated CI to GitLab")
    expect(withFacts.user).toContain("GAPS")
    expect(withFacts.user).toContain("- Kubernetes in production")
    expect(withFacts.user).toContain("Ready to work remotely.")
    expect(withoutFacts.user).not.toContain("CONFIRMED FACTS")
    expect(withoutFacts.user).not.toContain("GAPS")
    expect(withoutFacts.user).toContain("APPLICANT NOTES\nnone")
  })
})

describe("answers prompt", () => {
  test("the Russian system keeps the questionnaire rules and the JSON shape", () => {
    const prompt = buildAnswersPrompt({
      vacancy: vacancyRu,
      resumeText: resumeRu,
      questions: ["Почему вы хотите к нам?", "Ваш опыт с Kubernetes?"]
    })

    expect(prompt.promptVersion).toBe(ANSWERS_PROMPT_VERSION)
    expect(prompt.system).toContain("Ответь на КАЖДЫЙ вопрос")
    expect(prompt.system).toContain("Не выдумывай опыт")
    expect(prompt.system).toContain("Не оставляй вопрос пустым")
    expect(prompt.system).toContain("needsHuman=true")
    expect(prompt.system).toContain("«нет в резюме»")
    expect(prompt.system).toContain("Не используй тире (—, –)")
    expect(prompt.system).toContain(
      '[{"question":"точный текст вопроса","answer":"ответ","confidence":0.8,"needsHuman":false}]'
    )
    expect(prompt.user).toContain("1. Почему вы хотите к нам?")
    expect(prompt.user).toContain("2. Ваш опыт с Kubernetes?")
    expect(prompt.user).toContain("VACANCY")
    expect(prompt.user).toContain("RESUME")
    expect(prompt.user).toContain("APPLICANT NOTES")
    expect(prompt.user).toContain("верни только JSON-массив")
    expect(prompt.user).not.toMatch(/[—–]/)
  })

  test("the English system forbids telling the employer what the resume lacks", () => {
    const prompt = buildAnswersPrompt({
      vacancy,
      resumeText,
      questions: ["Why this company?"],
      language: "en"
    })

    expect(prompt.system).toContain("Answer EVERY question")
    expect(prompt.system).toContain("Do not invent experience")
    expect(prompt.system).toContain("needsHuman=true")
    expect(prompt.system).toContain("Never write in an answer that something is missing")
    expect(prompt.system).toContain("Do not use em or en dashes (—, –)")
    expect(prompt.system).toContain(
      '[{"question":"the exact question","answer":"the answer","confidence":0.8,"needsHuman":false}]'
    )
    expect(prompt.user).toContain("1. Why this company?")
    expect(prompt.user).toContain("return only the JSON array")
    expect(prompt.user).not.toMatch(/[—–]/)
  })

  test("questions stay numbered and in the given order", () => {
    const prompt = buildAnswersPrompt({
      vacancy,
      resumeText,
      questions: ["First?", "Second?", "Third?"],
      language: "en"
    })

    expect(prompt.user.indexOf("1. First?")).toBeLessThan(prompt.user.indexOf("2. Second?"))
    expect(prompt.user.indexOf("2. Second?")).toBeLessThan(prompt.user.indexOf("3. Third?"))
  })
})

describe("resume prompt", () => {
  test("auto detects the language from the resume itself", () => {
    const prompt = buildResumePrompt({ text: resumeRu })

    expect(prompt.language).toBe("ru")
    expect(prompt.promptVersion).toBe(RESUME_PROMPT_VERSION)
    expect(prompt.system).toContain("Не выдумывай опыт")
    expect(prompt.system).toContain("Сохраняй всех работодателей")
    expect(prompt.system).toContain("Не используй тире (—, –)")
    expect(prompt.user).toContain("ORIGINAL RESUME")
    expect(prompt.user).toContain(resumeRu)
    expect(prompt.user).toContain("верни только текст резюме")
    expect(prompt.user).not.toMatch(/[—–]/)
  })

  test("the English variant keeps the same no-invention rules", () => {
    const prompt = buildResumePrompt({
      text: resumeText,
      targetRole: "Platform Engineer",
      language: "en"
    })

    expect(prompt.system).toContain("Do not invent experience")
    expect(prompt.system).toContain("Keep every employer")
    expect(prompt.system).toContain("Do not use em or en dashes (—, –)")
    expect(prompt.system).toContain("Return only the rewritten resume text")
    expect(prompt.user).toContain("LANGUAGE: en")
    expect(prompt.user).toContain("TARGET ROLE: Platform Engineer")
    expect(prompt.user).toContain(resumeText)
    expect(prompt.user).toContain("return only the resume text")
  })

  test("a resume rewrite without a target role uses the roles already present", () => {
    const prompt = buildResumePrompt({ text: resumeText, language: "en" })
    expect(prompt.user).toContain("TARGET ROLE: the roles already present in the resume")
  })
})
