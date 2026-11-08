/**
 * Pure prompt builders for the writing features.
 *
 * The cloud never calls a model. These functions turn already-loaded rows into
 * one deterministic prompt, and the inference harness runs it. Keeping them
 * pure means a prompt can be asserted in a unit test without Postgres.
 *
 * Two prompts: the draft (cover letter and form answers in one call, used by
 * the web and the auto-apply runner alike) and the resume rewrite. Each has a
 * Russian and an English variant.
 */

/** The two languages a written answer can be produced in. */
export type WritingLanguage = "ru" | "en"

/** `auto` detects the language from the vacancy or resume text. */
export type WritingLanguageOption = WritingLanguage | "auto"

/** One prompt ready for `InferencePayload`: system + user turn. */
export interface WritingPrompt {
  readonly system: string
  readonly user: string
  readonly language: WritingLanguage
  readonly promptVersion: string
}

export interface VacancyContext {
  readonly title: string
  readonly employer?: string | null
  readonly description?: string | null
  readonly skills?: ReadonlyArray<string>
}

export interface ResumePromptInput {
  readonly text: string
  readonly targetRole?: string
  readonly language?: WritingLanguageOption
}

/**
 * "Russian if Cyrillic is more than a quarter of the Latin letters, otherwise
 * English". The same binary threshold the old project used: a letter has only
 * two languages, so the test is deliberately softer than a mixed-text marker.
 */
export const detectWritingLanguage = (value: string): WritingLanguage => {
  const cyrillic = (value.match(/[А-Яа-яЁё]/g) ?? []).length
  const latin = (value.match(/[A-Za-z]/g) ?? []).length
  return cyrillic > latin * 0.25 ? "ru" : "en"
}

const resolveLanguage = (
  choice: WritingLanguageOption | undefined,
  source: string
): WritingLanguage =>
  choice === undefined || choice === "auto" ? detectWritingLanguage(source) : choice

const text = (value: string | null | undefined): string => value?.trim() ?? ""

interface Labels {
  readonly notSpecified: string
  readonly notListed: string
  readonly notProvided: string
  readonly noResume: string
  readonly none: string
}

const LABELS: Record<WritingLanguage, Labels> = {
  ru: {
    notSpecified: "не указано",
    notListed: "не указаны",
    notProvided: "не указано",
    noResume: "(текст резюме не передан; не выдумывай опыт)",
    none: "нет"
  },
  en: {
    notSpecified: "not specified",
    notListed: "not listed",
    notProvided: "not provided",
    noResume: "(no resume text is available; do not invent experience)",
    none: "none"
  }
}

const vacancyHaystack = (vacancy: VacancyContext): string =>
  [
    vacancy.title,
    vacancy.employer ?? "",
    vacancy.description ?? "",
    ...(vacancy.skills ?? [])
  ].join("\n")

const vacancyBlock = (language: WritingLanguage, vacancy: VacancyContext): string => {
  const labels = LABELS[language]
  const skills = (vacancy.skills ?? []).map(text).filter((skill) => skill !== "")

  return [
    "VACANCY",
    `Title: ${text(vacancy.title) || labels.notSpecified}`,
    `Employer: ${text(vacancy.employer) || labels.notSpecified}`,
    `Skills: ${skills.length === 0 ? labels.notListed : skills.join(", ")}`,
    "Description:",
    text(vacancy.description) || labels.notProvided
  ].join("\n")
}

const resumeBlock = (language: WritingLanguage, resumeText: string | null | undefined): string => {
  const resume = text(resumeText)
  return ["RESUME", resume === "" ? LABELS[language].noResume : resume].join("\n")
}

export type CoverLetterLength = "short" | "medium" | "long"

/* -------------------------------------------------------------------------- */
/* Resume                                                                     */
/* -------------------------------------------------------------------------- */

export const RESUME_PROMPT_VERSION = "resume-v2"

const RESUME_SYSTEM: Record<WritingLanguage, string> = {
  ru: [
    "Ты — карьерный ассистент и переписываешь резюме соискателя.",
    "Задача — сделать текст яснее и ближе к целевой роли, не меняя факты.",
    "",
    "Правила:",
    "- Сохраняй всех работодателей, должности, даты, образование и числа",
    "  точно так, как они написаны в исходном резюме.",
    "- Не выдумывай опыт, компании, образование, навыки, достижения и метрики.",
    "- Не добавляй технологии, которых нет в исходном тексте.",
    "- Никогда не пиши, что чего-то «нет в резюме» или что информация отсутствует.",
    "- Не используй тире (—, –). Для диапазонов пиши «от … до …» или дефис: 400-700.",
    "- Улучшай формулировки, порядок и акценты; убирай повторы и канцелярит.",
    "- Не используй Markdown, списки, заголовки, эмодзи и кавычки вокруг названий.",
    "- Пиши на том же языке, что и исходное резюме.",
    "- Верни только переписанный текст резюме, без комментариев и пояснений."
  ].join("\n"),
  en: [
    "You are a career assistant rewriting the applicant's resume.",
    "The goal is a clearer text closer to the target role, with the same facts.",
    "",
    "Rules:",
    "- Keep every employer, job title, date, education entry and number exactly",
    "  as written in the original resume.",
    "- Do not invent experience, companies, education, skills, achievements or metrics.",
    "- Do not add technologies that are absent from the original text.",
    "- Never write that something is missing from the resume or that information is unavailable.",
    '- Do not use em or en dashes (—, –). For ranges write "from … to …" or a hyphen: 400-700.',
    "- Improve wording, ordering and emphasis; remove repetition and corporate filler.",
    "- No Markdown, lists, headings, emoji or quotation marks around names.",
    "- Keep the same language as the resume.",
    "- Return only the rewritten resume text, without comments or explanations."
  ].join("\n")
}

const TARGET_ROLE_DEFAULT: Record<WritingLanguage, string> = {
  ru: "роли, уже указанные в резюме",
  en: "the roles already present in the resume"
}

export const buildResumePrompt = (input: ResumePromptInput): WritingPrompt => {
  const language = resolveLanguage(input.language, input.text)
  const targetRole = text(input.targetRole) || TARGET_ROLE_DEFAULT[language]

  const user = [
    `LANGUAGE: ${language}${language === "ru" ? " (перепиши на этом языке)" : " (rewrite in this language)"}`,
    `TARGET ROLE: ${targetRole}`,
    "",
    "ORIGINAL RESUME",
    text(input.text),
    "",
    language === "ru"
      ? "Перепиши резюме целиком. Соблюдай правила из системного сообщения и верни только текст резюме."
      : "Rewrite the complete resume. Follow the system rules and return only the resume text."
  ].join("\n")

  return {
    system: RESUME_SYSTEM[language],
    user,
    language,
    promptVersion: RESUME_PROMPT_VERSION
  }
}


/* -------------------------------------------------------------------------- */
/* Draft: cover letter and employer-test answers in one call                  */
/* -------------------------------------------------------------------------- */

/*
 * The one prompt behind both the web "generate" button and the auto-apply
 * runner. The cloud fills it from the vacancy, the resume, the operator's
 * resume enrichment and the deterministic form hints; `parseGeneratedDraft`
 * checks the answer against the real form.
 */

export const DRAFT_PROMPT_VERSION = "draft-v3"

/** Whether the applicant works right now; decides «на текущем» or «на прошлом» месте. */
export type Employment = "current" | "past" | "unknown"

/**
 * The operator's override wins. Otherwise the applicant works now when any job
 * in the resume has a start date and no end date ("по настоящее время").
 */
export const resolveEmployment = (
  override: boolean | null | undefined,
  experience: ReadonlyArray<unknown>
): Employment => {
  if (typeof override === "boolean") return override ? "current" : "past"
  const jobs = experience.map((raw) => (raw ?? {}) as Record<string, unknown>)
  if (jobs.length === 0) return "unknown"
  const open = jobs.some((job) => {
    const start = typeof job.startDate === "string" ? job.startDate.trim() : ""
    const end = typeof job.endDate === "string" ? job.endDate.trim() : ""
    return start !== "" && end === ""
  })
  return open ? "current" : "past"
}

export interface DraftQuestion {
  readonly id: string
  readonly kind: "single" | "multiple" | "text" | "code"
  readonly text: string
  readonly required: boolean
  readonly maxLength?: number | null
  readonly codeLanguage?: string | null
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

/**
 * A deterministic answer for one question (`answerHints`). A hard hint is
 * final, so its question is not sent to the model at all; a soft one is shown
 * as a suggestion. Hints with blockers are never shown.
 */
export interface DraftHint {
  readonly questionId: string
  readonly kind: string
  readonly optionIds?: ReadonlyArray<string>
  readonly text?: string
  readonly hard: boolean
  readonly note?: string | null
  readonly blockers?: ReadonlyArray<string>
}

/** What the operator told about the applicant beyond the resume text. */
export interface ApplicantProfile {
  readonly comment?: string | null
  readonly salaries?: ReadonlyArray<{
    readonly currency: string
    readonly min?: number | null
    readonly expectation?: number | null
  }>
  /** Questions and answers, known topics already resolved to their question text. */
  readonly faq?: ReadonlyArray<{ readonly question: string; readonly answer: string }>
  /** Per job: `job` names it (company and position). */
  readonly jobs?: ReadonlyArray<{
    readonly job: string
    readonly comment?: string | null
    readonly leaveReason?: string | null
    readonly employmentType?: string | null
  }>
}

export interface DraftPromptInput {
  readonly vacancy: VacancyContext
  readonly resumeText?: string | null
  /** `absent`: hh does not take a letter; `optional`/`required` otherwise. */
  readonly coverLetter: "required" | "optional" | "absent"
  readonly questions: ReadonlyArray<DraftQuestion>
  readonly hints?: ReadonlyArray<DraftHint>
  readonly profile?: ApplicantProfile | null
  /** Free text the operator wrote for this vacancy. */
  readonly notes?: string | null
  /** Who is applying. The only name the model may use for the applicant. */
  readonly applicant?: { readonly firstName?: string | null; readonly lastName?: string | null } | null
  /** Short by default: recruiters skim. */
  readonly length?: CoverLetterLength
  readonly employment?: Employment
  readonly language?: WritingLanguageOption
}

/** Ceilings, not targets: models pad up to whatever number they are given. */
const DRAFT_LENGTH_RULES: Record<WritingLanguage, Record<CoverLetterLength, string>> = {
  ru: {
    short: "не больше 400 знаков, 1-2 абзаца",
    medium: "не больше 700 знаков, 2-3 абзаца",
    long: "не больше 1000 знаков, 3-4 абзаца"
  },
  en: {
    short: "at most 400 characters, 1-2 paragraphs",
    medium: "at most 700 characters, 2-3 paragraphs",
    long: "at most 1000 characters, 3-4 paragraphs"
  }
}

const EMPLOYMENT_RULES: Record<WritingLanguage, Record<Employment, string>> = {
  ru: {
    current: "соискатель работает сейчас: говори «на текущем месте работы», не «на прошлом»",
    past: "соискатель сейчас не работает: говори «на прошлом месте работы», не «на текущем»",
    unknown: "неизвестно, работает ли соискатель сейчас: не говори «текущее» или «прошлое» место, называй компанию из резюме"
  },
  en: {
    current: 'the applicant works now: say "at my current job", never "at my previous job"',
    past: 'the applicant does not work now: say "at my previous job", never "at my current job"',
    unknown: "unknown whether the applicant works now: do not say current or previous job, name the company from the resume"
  }
}

const DRAFT_SYSTEM: Record<WritingLanguage, string> = {
  ru: [
    "Ты помогаешь соискателю откликнуться на вакансию на hh.ru: пишешь сопроводительное",
    "письмо и отвечаешь на вопросы работодателя от первого лица соискателя.",
    "",
    "Источники: APPLICANT, VACANCY, RESUME, APPLICANT NOTES. APPLICANT NOTES написал сам",
    "соискатель: это правда, и при расхождении с резюме верь им.",
    "",
    "Общие правила:",
    "- Называй соискателя только именем из APPLICANT, никаких других имён.",
    "- Не выдумывай компании, проекты, метрики, образование, зарплату и другие факты.",
    "- Технологии. Если технологии из вакансии нет в источниках, но у соискателя есть",
    "  близкий аналог или её можно освоить за неделю (библиотека, инструмент, сервис",
    "  рядом с его стеком), её можно назвать знакомой. Если ничего похожего нет,",
    "  не упоминай её в письме.",
    "- Никогда не пиши, что чего-то нет в резюме или что данных нет.",
    "- Без тире (—, –), эмодзи, Markdown, списков, восклицательных знаков и кавычек",
    "  вокруг названий. Для диапазонов пиши дефис: 400-700.",
    "",
    "Письмо (если COVER LETTER: absent, верни в letter пустую строку и пропусти этот раздел):",
    "- Рекрутер уже видит резюме и вакансию. Начни с приветствия, без подписи",
    "  и формального завершения. Не представляйся и не называй вакансию и компанию.",
    "- Если вакансия просит написать в письме что-то конкретное (о проекте, опыте,",
    "  мотивации, сроке выхода, ссылке, зарплате, слово-пароль), это главное",
    "  содержание письма: ответь на каждую такую просьбу по существу.",
    "- Не пересказывай резюме и не перечисляй достижения, метрики и проекты из него:",
    "  они уже в резюме. Скажи общими словами, почему подходишь: с какими технологиями",
    "  и задачами из вакансии уже работал, чем интересна сфера или продукт компании.",
    "- Длина в LENGTH: это потолок, а не цель. Абзацы по смыслу.",
    "- Говоря о месте работы, следуй EMPLOYMENT.",
    "- Пиши живо, как человек, без канцелярита, лести и общих слов вроде",
    "  «стрессоустойчивость» и «командный игрок».",
    "",
    "Вопросы (QUESTIONS):",
    "- Ответь на каждый вопрос. Для single и multiple верни optionIds только из",
    "  вариантов этого вопроса, для single ровно один. Для text верни text: от одного",
    "  до четырёх предложений, не длиннее maxLength.",
    "- Если у вопроса есть hint, это ответ из данных соискателя: бери его, можно",
    "  переформулировать.",
    "- «Работали ли вы с X?»: да, если X, близкий аналог или что-то осваиваемое",
    "  за неделю есть в источниках; иначе честно нет.",
    "- Зарплата: число из APPLICANT NOTES, иначе середина вилки вакансии, иначе",
    "  средняя рыночная сумма для роли и уровня в форме «от N». Без знака валюты",
    "  и без уклончивых ответов.",
    "- Причину ухода, формат работы на прошлом месте и другие факты о соискателе бери",
    "  только из источников. Если их нет: в вопросе с вариантами выбери самый",
    "  правдоподобный, в text верни пустую строку, соискатель ответит сам.",
    "",
    "Верни строго один JSON-объект без Markdown и комментариев:",
    '{"letter":"текст письма","answers":[{"questionId":"id вопроса","optionIds":["id варианта"],"text":"ответ"}]}'
  ].join("\n"),
  en: [
    "You help an applicant respond to an hh.ru vacancy: you write the cover letter and",
    "answer the employer's questions in the applicant's first person.",
    "",
    "Sources: APPLICANT, VACANCY, RESUME, APPLICANT NOTES. APPLICANT NOTES come from the",
    "applicant: they are true, and they win over the resume when the two differ.",
    "",
    "General rules:",
    "- Call the applicant only by the name in APPLICANT, never any other name.",
    "- Do not invent companies, projects, metrics, education, salary or other facts.",
    "- Technologies. When a technology from the vacancy is not in the sources but the",
    "  applicant has a close analogue, or it can be learned in a week (a library, tool",
    "  or service next to their stack), it may be called familiar. When nothing similar",
    "  is there, do not mention it in the letter.",
    "- Never write that something is missing from the resume or that data is unavailable.",
    "- No em or en dashes (—, –), emoji, Markdown, lists, exclamation marks or quotes",
    "  around names. Use a plain hyphen for ranges: 400-700.",
    "",
    "Letter (when COVER LETTER: absent, return an empty letter and skip this section):",
    "- The recruiter already sees the resume and the vacancy. Start with a greeting,",
    "  no signature or formal sign-off. Do not introduce yourself or name the role or company.",
    "- When the vacancy asks for something specific in the letter (a project, experience,",
    "  motivation, start date, a link, salary, a code word), that is the main content:",
    "  answer every such request to the point.",
    "- Do not retell the resume or list its achievements, metrics and projects: they are",
    "  already in the resume. Say in general words why you fit: which technologies and",
    "  tasks from the vacancy you have worked with, what draws you to the company's field",
    "  or product.",
    "- Length is set in LENGTH: a ceiling, not a target. Split paragraphs by meaning.",
    "- When mentioning a workplace, follow EMPLOYMENT.",
    "- Write like a person, without corporate filler, flattery or clichés.",
    "",
    "Questions (QUESTIONS):",
    "- Answer every question. For single and multiple return optionIds only from that",
    "  question's options, exactly one for single. For text return text: one to four",
    "  sentences, within maxLength.",
    "- kind=code is a programming task: solve it and return the working code as plain",
    "  text in the language given by language=, with real line breaks, no Markdown",
    "  fences, no explanations unless the task asks for them.",
    "- A question with a hint has an answer from the applicant's data: use it, you may",
    "  rephrase it.",
    '- "Have you worked with X?": yes when X, a close analogue or something learnable in',
    "  a week is in the sources; otherwise an honest no.",
    "- Salary: the number from APPLICANT NOTES, else the middle of the vacancy range, else",
    '  the average market salary for the role and level as "from N". No currency sign,',
    "  no evasive answers.",
    "- The reason for leaving, the previous work format and other facts about the",
    "  applicant come only from the sources. Without them: pick the most plausible option",
    "  in a choice question, return an empty text in a text question, the applicant",
    "  will answer it.",
    "",
    "Return exactly one JSON object, no Markdown, no comments:",
    '{"letter":"cover letter text","answers":[{"questionId":"question id","optionIds":["option id"],"text":"answer"}]}'
  ].join("\n")
}

const applicantBlock = (language: WritingLanguage, applicant: DraftPromptInput["applicant"]): string => {
  const name = [text(applicant?.firstName), text(applicant?.lastName)].filter((part) => part !== "").join(" ")
  const missing = language === "ru" ? "(не указано: не представляйся по имени)" : "(not provided: do not introduce yourself by name)"
  return ["APPLICANT", `Name: ${name === "" ? missing : name}`].join("\n")
}

const salaryLine = (language: WritingLanguage, salary: NonNullable<ApplicantProfile["salaries"]>[number]): string | null => {
  const parts = [
    salary.expectation == null ? null : `${language === "ru" ? "ожидание" : "expectation"} ${salary.expectation}`,
    salary.min == null ? null : `${language === "ru" ? "минимум" : "minimum"} ${salary.min}`
  ].filter((part) => part !== null)
  return parts.length === 0 ? null : `${parts.join(", ")} ${salary.currency}`
}

/** The operator's notes and the resume enrichment, as plain lines. */
const draftNotesBlock = (
  language: WritingLanguage,
  notes: string | null | undefined,
  profile: ApplicantProfile | null | undefined
): string => {
  const ru = language === "ru"
  const lines: Array<string> = []
  const free = text(notes)
  if (free !== "") lines.push(free)
  const comment = text(profile?.comment)
  if (comment !== "") lines.push(comment)

  const salaries = (profile?.salaries ?? []).map((salary) => salaryLine(language, salary)).filter((line) => line !== null)
  if (salaries.length > 0) lines.push(`${ru ? "Зарплата" : "Salary"}: ${salaries.join("; ")}`)

  for (const entry of profile?.faq ?? []) {
    const question = text(entry.question)
    const answer = text(entry.answer)
    if (answer !== "") lines.push(question === "" ? answer : `${question} ${answer}`)
  }

  for (const job of profile?.jobs ?? []) {
    const facts = [
      text(job.comment),
      text(job.leaveReason) === "" ? "" : `${ru ? "причина ухода" : "reason for leaving"}: ${text(job.leaveReason)}`,
      text(job.employmentType) === "" ? "" : `${ru ? "формат" : "format"}: ${text(job.employmentType)}`
    ].filter((fact) => fact !== "")
    if (facts.length > 0) lines.push(`${text(job.job) || (ru ? "место работы" : "a job")}: ${facts.join("; ")}`)
  }

  return ["APPLICANT NOTES", lines.length === 0 ? LABELS[language].none : lines.map((line) => `- ${line}`).join("\n")].join("\n")
}

/** The question a model still has to answer: not fixed by a hard hint. */
const shownHint = (hint: DraftHint | undefined): DraftHint | undefined =>
  hint === undefined || (hint.blockers ?? []).length > 0 ? undefined : hint

const hintValue = (question: DraftQuestion, hint: DraftHint): string => {
  const labels = (hint.optionIds ?? [])
    .map((id) => question.options.find((option) => option.id === id)?.label)
    .filter((label) => label !== undefined)
  return labels.length > 0 ? labels.join(", ") : text(hint.text)
}

/**
 * Questions with a usable hard hint are answered without the model, so they
 * are left out. "Have you used X?" hints are a blanket "yes":
 * the prompt's own rule decides those, so that hint is not shown.
 */
const modelQuestions = (
  questions: ReadonlyArray<DraftQuestion>,
  hints: ReadonlyArray<DraftHint>
): ReadonlyArray<{ readonly question: DraftQuestion; readonly hint: string | null }> => {
  const byQuestion = new Map(hints.map((hint) => [hint.questionId, hint]))
  return questions.flatMap((question) => {
    const hint = shownHint(byQuestion.get(question.id))
    if (hint?.hard === true && hintValue(question, hint) !== "") return []
    const value = hint === undefined || hint.kind === "tool_experience" ? "" : hintValue(question, hint)
    return [{ question, hint: value === "" ? null : value }]
  })
}

const draftQuestionBlock = (
  questions: ReadonlyArray<{ readonly question: DraftQuestion; readonly hint: string | null }>
): string =>
  questions.length === 0
    ? "- none"
    : questions
        .map(({ question, hint }, index) =>
          [
            `${index + 1}. id=${question.id} kind=${question.kind}` +
              (question.maxLength != null ? ` maxLength=${question.maxLength}` : "") +
              (question.kind === "code" && question.codeLanguage != null ? ` language=${question.codeLanguage}` : ""),
            `   ${text(question.text)}`,
            ...question.options.map((option) => `   - optionId=${option.id}: ${text(option.label)}`),
            ...(hint === null ? [] : [`   hint: ${hint}`])
          ].join("\n")
        )
        .join("\n")

export const buildDraftPrompt = (input: DraftPromptInput): WritingPrompt => {
  const language = resolveLanguage(input.language, vacancyHaystack(input.vacancy))
  const user = [
    `LANGUAGE: ${language}${language === "ru" ? " (пиши по-русски)" : " (write in English)"}`,
    `COVER LETTER: ${input.coverLetter}`,
    `LENGTH: ${DRAFT_LENGTH_RULES[language][input.length ?? "short"]}`,
    `EMPLOYMENT: ${EMPLOYMENT_RULES[language][input.employment ?? "unknown"]}`,
    "",
    applicantBlock(language, input.applicant),
    "",
    vacancyBlock(language, input.vacancy),
    "",
    resumeBlock(language, input.resumeText),
    "",
    draftNotesBlock(language, input.notes, input.profile),
    "",
    "QUESTIONS:",
    draftQuestionBlock(modelQuestions(input.questions, input.hints ?? []))
  ].join("\n")
  return { system: DRAFT_SYSTEM[language], user, language, promptVersion: DRAFT_PROMPT_VERSION }
}
