/**
 * Pure prompt builders for the writing features.
 *
 * The cloud never calls a model. These functions turn already-loaded rows into
 * one deterministic prompt, and the inference harness runs it. Keeping them
 * pure means a prompt can be asserted in a unit test without Postgres.
 */

export type CoverLetterLength = "short" | "medium" | "long"

export interface VacancyContext {
  readonly title: string
  readonly employer?: string | null
  readonly description?: string | null
  readonly skills?: ReadonlyArray<string>
}

export interface CoverLetterPromptInput {
  readonly vacancy: VacancyContext
  readonly resumeText?: string | null
  readonly tone?: string
  readonly length?: CoverLetterLength
}

export interface AnswersPromptInput {
  readonly vacancy: VacancyContext
  readonly resumeText?: string | null
  readonly questions: ReadonlyArray<string>
}

export interface ResumePromptInput {
  readonly text: string
  readonly targetRole?: string
}

/**
 * The invariants every writing prompt shares. They live in the system message
 * so the prompt body stays focused on the task and its output contract.
 */
export const WRITING_SYSTEM_PROMPT = [
  "You write job application material for hh.ru.",
  "Use only facts that appear in the supplied resume and vacancy.",
  "Never invent employers, dates, degrees, metrics, skills or experience.",
  "Write in the language of the vacancy or resume.",
  "Do not use emoji, exclamation marks, em dashes or markdown fences.",
  "Return exactly the requested output, with no preamble and no commentary."
].join(" ")

const LENGTH_GUIDE: Record<CoverLetterLength, string> = {
  short: "short: at most 90 words, 3 to 4 sentences",
  medium: "medium: 90 to 160 words, 5 to 7 sentences",
  long: "long: 160 to 260 words, 8 to 12 sentences"
}

const DEFAULT_LENGTH: CoverLetterLength = "medium"

const text = (value: string | null | undefined): string => value?.trim() ?? ""

const vacancyBlock = (vacancy: VacancyContext): string => {
  const skills = (vacancy.skills ?? []).map(text).filter((skill) => skill !== "")
  return [
    "Vacancy:",
    `Title: ${text(vacancy.title) || "not specified"}`,
    `Employer: ${text(vacancy.employer) || "not specified"}`,
    `Skills: ${skills.length === 0 ? "not listed" : skills.join(", ")}`,
    "Description:",
    text(vacancy.description) || "not provided"
  ].join("\n")
}

const resumeBlock = (resumeText: string | null | undefined): string => {
  const resume = text(resumeText)
  return resume === ""
    ? "Resume:\n(no resume text is available; do not invent experience)"
    : `Resume:\n${resume}`
}

const questionsBlock = (questions: ReadonlyArray<string>): string =>
  questions
    .map((question, index) => `${index + 1}. ${text(question)}`)
    .join("\n")

export const buildCoverLetterPrompt = (input: CoverLetterPromptInput): string => {
  const tone = text(input.tone) || "professional, specific and direct"
  const length = LENGTH_GUIDE[input.length ?? DEFAULT_LENGTH]

  return [
    "Write a cover letter for this application.",
    "",
    "Rules:",
    "- Use only facts from the resume and the vacancy.",
    "- Address what this employer actually asks for, not a generic template.",
    "- Name the employer and the role; never leave placeholders like [Company].",
    `- Tone: ${tone}.`,
    `- Length: ${length}.`,
    "- Return only the letter text: no subject line, no markdown, no preamble.",
    "",
    vacancyBlock(input.vacancy),
    "",
    resumeBlock(input.resumeText)
  ].join("\n")
}

export const buildAnswersPrompt = (input: AnswersPromptInput): string => {
  return [
    "Answer the employer's questions for this application.",
    "",
    "Rules:",
    "- Use only facts from the resume and the vacancy.",
    "- If a fact is not in the resume, say plainly that it is not there instead of inventing it.",
    "- Write in the first person, concrete and brief: one to four sentences per answer.",
    "- Copy each question exactly as it is written.",
    "- Return one object per question, in the same order.",
    "- Return a JSON array only, with exactly this shape and nothing else:",
    '[{"question":"...","answer":"..."}]',
    "- Do not wrap the JSON in markdown fences and do not add commentary.",
    "",
    "Questions:",
    questionsBlock(input.questions),
    "",
    vacancyBlock(input.vacancy),
    "",
    resumeBlock(input.resumeText)
  ].join("\n")
}

export const buildResumePrompt = (input: ResumePromptInput): string => {
  const targetRole = text(input.targetRole) || "the roles already present in the resume"

  return [
    "Rewrite this resume for the target role.",
    "",
    "Rules:",
    "- Keep every employer, job title, date, education entry and number exactly as written.",
    "- Do not invent experience, skills, achievements or metrics.",
    "- Improve wording, ordering and relevance; remove repetition.",
    "- Keep the same language as the resume.",
    `- Target role: ${targetRole}.`,
    "- Return only the rewritten resume text: no preamble, no markdown fences, no commentary.",
    "",
    "Resume:",
    text(input.text)
  ].join("\n")
}
