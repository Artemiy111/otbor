import { describe, expect, test } from "bun:test"
import {
  buildAnswersPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  WRITING_SYSTEM_PROMPT
} from "../src/writing/prompts.ts"

const vacancy = {
  title: "Senior DevOps Engineer",
  employer: "Acme Cloud",
  description: "Own Kubernetes and Terraform for a payments platform.",
  skills: ["Kubernetes", "Terraform", "Postgres"]
}

const resumeText = "DevOps engineer since 2018. Migrated CI to GitLab."

describe("writing prompts", () => {
  test("the shared system prompt forbids invention and boilerplate", () => {
    expect(WRITING_SYSTEM_PROMPT).toContain("Never invent")
    expect(WRITING_SYSTEM_PROMPT).toContain("emoji")
    expect(WRITING_SYSTEM_PROMPT).toContain("no preamble")
  })

  test("a cover letter carries the vacancy, skills, resume, tone and length", () => {
    const prompt = buildCoverLetterPrompt({
      vacancy,
      resumeText,
      tone: "calm and concrete",
      length: "short"
    })

    expect(prompt).toContain("Write a cover letter")
    expect(prompt).toContain("Title: Senior DevOps Engineer")
    expect(prompt).toContain("Employer: Acme Cloud")
    expect(prompt).toContain("Kubernetes, Terraform, Postgres")
    expect(prompt).toContain("Own Kubernetes and Terraform")
    expect(prompt).toContain(resumeText)
    expect(prompt).toContain("Tone: calm and concrete")
    expect(prompt).toContain("at most 90 words")
    expect(prompt).toContain("Return only the letter text")
  })

  test("a cover letter defaults to medium and says when no resume is attached", () => {
    const prompt = buildCoverLetterPrompt({ vacancy, resumeText: null })

    expect(prompt).toContain("90 to 160 words")
    expect(prompt).toContain("no resume text is available")
    expect(prompt).toContain("professional, specific and direct")
  })

  test("answers number every question and demand a bare JSON array", () => {
    const prompt = buildAnswersPrompt({
      vacancy,
      resumeText,
      questions: ["Why this company?", "Describe a migration you led."]
    })

    expect(prompt).toContain("1. Why this company?")
    expect(prompt).toContain("2. Describe a migration you led.")
    expect(prompt).toContain('[{"question":"...","answer":"..."}]')
    expect(prompt).toContain("JSON array only")
    expect(prompt).toContain("Copy each question exactly")
    expect(prompt).toContain("Title: Senior DevOps Engineer")
    expect(prompt).toContain(resumeText)
  })

  test("a resume rewrite keeps facts and names the target role", () => {
    const prompt = buildResumePrompt({
      text: resumeText,
      targetRole: "Platform Engineer"
    })

    expect(prompt).toContain("Rewrite this resume")
    expect(prompt).toContain("Target role: Platform Engineer")
    expect(prompt).toContain("Keep every employer")
    expect(prompt).toContain("Do not invent")
    expect(prompt).toContain("Return only the rewritten resume text")
    expect(prompt).toContain(resumeText)
  })

  test("a resume rewrite without a target role uses the roles already present", () => {
    const prompt = buildResumePrompt({ text: resumeText })
    expect(prompt).toContain("Target role: the roles already present in the resume")
  })
})
