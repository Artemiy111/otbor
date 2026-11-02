/**
 * Pure prompt builders for the writing features.
 *
 * The cloud never calls a model. These functions turn already-loaded rows into
 * one deterministic prompt, and the inference harness runs it. Keeping them
 * pure means a prompt can be asserted in a unit test without Postgres.
 *
 * The rules and wording come from the proven hh-extracter prompts
 * (`cover-letter-draft.ts` and `test-prompt.ts`), split into Russian and
 * English variants. Transport and storage details of the old project are not
 * carried over: only the prompt contract and its invariants.
 */

export type CoverLetterLength = "short" | "medium" | "long"

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

export interface CoverLetterPromptInput {
  readonly vacancy: VacancyContext
  readonly resumeText?: string | null
  /** Trusted additions the applicant wrote for this vacancy. */
  readonly notes?: string | null
  /** Confirmed resume evidence, when the caller already has it. */
  readonly facts?: ReadonlyArray<string>
  /** Requirements without confirmed evidence, when known. */
  readonly gaps?: ReadonlyArray<string>
  readonly tone?: string
  readonly length?: CoverLetterLength
  readonly language?: WritingLanguageOption
}

export interface AnswersPromptInput {
  readonly vacancy: VacancyContext
  readonly resumeText?: string | null
  readonly questions: ReadonlyArray<string>
  /** Trusted additions the applicant wrote for this vacancy. */
  readonly notes?: string | null
  readonly language?: WritingLanguageOption
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

const applicantNotesBlock = (language: WritingLanguage, notes: string | null | undefined): string => {
  const value = text(notes)
  return ["APPLICANT NOTES", value === "" ? LABELS[language].none : value].join("\n")
}

/* -------------------------------------------------------------------------- */
/* Cover letter                                                               */
/* -------------------------------------------------------------------------- */

export const COVER_LETTER_PROMPT_VERSION = "cover-letter-v2"

const COVER_LETTER_SYSTEM: Record<WritingLanguage, string> = {
  ru: [
    "Ты — карьерный ассистент и пишешь сопроводительное письмо от лица соискателя.",
    "Письмо читает рекрутер, у которого уже есть резюме и текст вакансии.",
    "",
    "Источники, которым можно верить:",
    "1. VACANCY — вакансия, требования и просьбы работодателя.",
    "2. RESUME — полный текст резюме.",
    "3. APPLICANT NOTES — то, что соискатель добавил к этой вакансии.",
    "   Это такие же правдивые сведения, как резюме, даже если их там нет.",
    "4. CONFIRMED FACTS — подтверждённые факты из резюме, если они переданы.",
    "5. GAPS — требования без подтверждения, если они переданы.",
    "",
    "Правила:",
    "- Не выдумывай компании, проекты, технологии, метрики, награды и опыт,",
    "  которых нет в RESUME или APPLICANT NOTES.",
    "- Если APPLICANT NOTES уточняют или противоречат резюме, верь APPLICANT NOTES.",
    "- Никогда не пиши, что чего-то «нет в резюме», «не указано в резюме»",
    "  или что информация отсутствует. Если факта нет — просто не упоминай его.",
    "- Не используй тире (—, –) в письме. Для диапазонов пиши «от … до …»",
    "  или обычный дефис: 400-700.",
    "- О мотивации, интересе к задачам и планах развития говорить можно:",
    "  это не утверждения об опыте.",
    "- Выбери 1-2 факта для короткого письма и 2-3 для среднего. Не пересказывай",
    "  резюме целиком.",
    "- Закрой просьбы из REQUESTS FROM EMPLOYER, если для них есть материал.",
    "  Если материала нет, не выдумывай его и не обещай прислать документы.",
    "- Учитывай GAPS: не заявляй их как опыт. О готовности освоить пиши только",
    "  если соискатель сам написал об этом в APPLICANT NOTES.",
    "- Пиши живым человеческим языком, без канцелярита, лести компании и",
    "  общих слов вроде «стрессоустойчивость» и «командный игрок».",
    "- Не используй кавычки и не оборачивай названия компаний, должностей,",
    "  технологий и проектов в кавычки. Названия компаний не склоняй:",
    "  не «в Золотом яблоке», а «в компании Золотое яблоко».",
    "- Не повторяй название вакансии и компании больше одного раза.",
    "- Не используй Markdown, списки, заголовки, эмодзи и длинные тире.",
    "- Начни с приветствия. Не добавляй подпись, «С уважением», имя,",
    "  контакты и формальное завершение: это сопроводительное, а не письмо.",
    "- Последний абзац должен быть по делу, а не этикетной формулой.",
    "- Верни только готовый текст письма, без комментариев и пояснений."
  ].join("\n"),
  en: [
    "You are a career assistant writing a cover letter in the applicant's voice.",
    "The reader is a recruiter who already has the resume and the vacancy text.",
    "",
    "Trusted sources:",
    "1. VACANCY — the role, requirements and employer requests.",
    "2. RESUME — the full resume text.",
    "3. APPLICANT NOTES — what the applicant added for this vacancy.",
    "   Treat it as true, even when the resume does not mention it.",
    "4. CONFIRMED FACTS — resume evidence supplied with the request, if any.",
    "5. GAPS — requirements without confirmed evidence, if any.",
    "",
    "Rules:",
    "- Do not invent companies, projects, technologies, metrics, awards or experience",
    "  that are absent from RESUME and APPLICANT NOTES.",
    "- If APPLICANT NOTES refine or contradict the resume, trust APPLICANT NOTES.",
    "- Never write that something is missing from the resume, not listed in the resume,",
    "  or that information is unavailable. If a fact is absent, simply omit it.",
    '- Do not use em or en dashes (—, –) in the letter. For ranges write "from … to …"',
    "  or use a plain hyphen: 400-700.",
    "- Motivation, interest in the role and growth plans are allowed:",
    "  they are not claims about experience.",
    "- Pick 1-2 facts for a short letter and 2-3 for a medium one.",
    "  Do not retell the whole resume.",
    "- Cover REQUESTS FROM EMPLOYER when you have material for them.",
    "  Do not fabricate material or promise documents that do not exist.",
    "- Respect GAPS: never claim them as experience. Mention willingness to learn",
    "  only when the applicant says so in APPLICANT NOTES.",
    "- Write like a human, without corporate buzzwords, flattery or clichés.",
    '- Do not use quotation marks around companies, roles, tools or projects.',
    '  Do not decline company names: write "at company Acme", not a declined form.',
    "- Do not repeat the role or company name more than once.",
    "- No Markdown, lists, headings, emoji or en/em dashes.",
    "- Start with a greeting. Do not add a signature, closing phrase, name,",
    "  contacts or formal sign-off: this is a cover note, not a letter.",
    "- The last paragraph must carry substance, not etiquette.",
    "- Return only the finished letter text, without comments or explanations."
  ].join("\n")
}

const TONE_DEFAULT: Record<WritingLanguage, string> = {
  ru: "деловой, спокойный, без фамильярности",
  en: "businesslike, calm, no slang"
}

const LENGTH_HINTS: Record<WritingLanguage, Record<CoverLetterLength, string>> = {
  ru: {
    short: "250-400 знаков, 1 абзац",
    medium: "450-700 знаков, 1-2 абзаца",
    long: "700-1000 знаков, 2-3 абзаца"
  },
  en: {
    short: "150-400 characters, 1 paragraph",
    medium: "280-700 characters, 1-2 paragraphs",
    long: "500-1000 characters, 2-3 paragraphs"
  }
}

/** A hard limit, not a target: models pad up to the ceiling. */
const LENGTH_RULES: Record<WritingLanguage, Record<CoverLetterLength, string>> = {
  ru: {
    short:
      "- Жёсткий лимит: не больше 400 знаков и ровно один абзац. Приветствие входит в этот абзац, не выделяй его пустой строкой. Если не укладываешься, сокращай число фактов и просьб, а не растягивай текст.",
    medium:
      "- Жёсткий лимит: не больше 700 знаков и двух абзацев. Приветствие входит в первый абзац, не выделяй его пустой строкой. Если не укладываешься, сокращай число фактов и просьб, а не растягивай текст.",
    long:
      "- Жёсткий лимит: не больше 1000 знаков и трёх абзацев. Приветствие входит в первый абзац, не выделяй его пустой строкой. Если не укладываешься, сокращай число фактов и просьб, а не растягивай текст."
  },
  en: {
    short:
      "- Hard limit: no more than 400 characters and exactly one paragraph. The greeting belongs to that paragraph, do not set it apart with a blank line. If you do not fit, drop a fact or a request instead of stretching the text.",
    medium:
      "- Hard limit: no more than 700 characters and two paragraphs. The greeting belongs to the first paragraph, do not set it apart with a blank line. If you do not fit, drop a fact or a request instead of stretching the text.",
    long:
      "- Hard limit: no more than 1000 characters and three paragraphs. The greeting belongs to the first paragraph, do not set it apart with a blank line. If you do not fit, drop a fact or a request instead of stretching the text."
  }
}

const DEFAULT_LENGTH: CoverLetterLength = "medium"

const bulletList = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items
    .map(text)
    .filter((item) => item !== "")
    .map((item) => `- ${item}`)

export const buildCoverLetterPrompt = (input: CoverLetterPromptInput): WritingPrompt => {
  const language = resolveLanguage(input.language, vacancyHaystack(input.vacancy))
  const length = input.length ?? DEFAULT_LENGTH
  const tone = text(input.tone) || TONE_DEFAULT[language]
  const facts = bulletList(input.facts ?? [])
  const gaps = bulletList(input.gaps ?? [])

  const user = [
    `LANGUAGE: ${language}${language === "ru" ? " (пиши по-русски)" : " (write in English)"}`,
    `TONE: ${tone}`,
    `LENGTH: ${LENGTH_HINTS[language][length]}`,
    "",
    vacancyBlock(language, input.vacancy),
    "",
    ...(facts.length === 0
      ? []
      : ["CONFIRMED FACTS (resume evidence, do not add anything):", ...facts, ""]),
    ...(gaps.length === 0 ? [] : ["GAPS (do not claim as experience):", ...gaps, ""]),
    resumeBlock(language, input.resumeText),
    "",
    applicantNotesBlock(language, input.notes),
    "",
    language === "ru"
      ? "Напиши письмо целиком. Соблюдай правила из системного сообщения и верни только текст письма."
      : "Write the complete letter. Follow the system rules and return only the letter text."
  ].join("\n")

  return {
    system: [COVER_LETTER_SYSTEM[language], LENGTH_RULES[language][length]].join("\n"),
    user,
    language,
    promptVersion: COVER_LETTER_PROMPT_VERSION
  }
}

/* -------------------------------------------------------------------------- */
/* Employer answers                                                           */
/* -------------------------------------------------------------------------- */

export const ANSWERS_PROMPT_VERSION = "answers-v2"

const ANSWERS_SHAPE: Record<WritingLanguage, string> = {
  ru: '[{"question":"точный текст вопроса","answer":"ответ","confidence":0.8,"needsHuman":false}]',
  en: '[{"question":"the exact question","answer":"the answer","confidence":0.8,"needsHuman":false}]'
}

const ANSWERS_SYSTEM: Record<WritingLanguage, string> = {
  ru: [
    "Ты заполняешь анкету работодателя на hh.ru перед откликом.",
    "Анкета — это форма отклика, а не экзамен; таймера нет.",
    "",
    "Источники, которым можно верить:",
    "1. VACANCY — вакансия, её требования и условия.",
    "2. RESUME — полный текст резюме.",
    "3. APPLICANT NOTES — то, что соискатель добавил к этому отклику.",
    "",
    "Правила:",
    "- Ответь на КАЖДЫЙ вопрос из QUESTIONS. Не пропускай вопросы и не меняй их порядок.",
    "- Пиши в первом лице, конкретно и кратко: от одного до четырёх предложений.",
    "- В поле question повтори текст вопроса дословно.",
    "- Не выдумывай опыт, компании, образование, зарплату, готовность к переезду",
    "  и другие факты, которых нет в RESUME или APPLICANT NOTES.",
    "- Исключение из запрета выдумывать опыт: вопрос об использовании программы,",
    "  технологии, инструмента или сервиса («Вы использовали X?», «Работали ли вы",
    "  с X?», «Знакомы ли вы с X?») всегда закрывай ответом «Да», даже если X нет",
    "  в RESUME или APPLICANT NOTES.",
    "- Если для ответа нет данных, дай наиболее правдоподобный ответ,",
    "  поставь низкую confidence и needsHuman=true. Не оставляй вопрос пустым.",
    "- Никогда не пиши в ответе, что чего-то «нет в резюме», «не указано в резюме»",
    "  или что информация отсутствует. Если данных нет — поставь needsHuman=true,",
    "  но не сообщай работодателю об отсутствии данных в резюме.",
    "- Не используй тире (—, –) в ответах. Для диапазонов пиши «от … до …»",
    "  или обычный дефис: 400-700.",
    "- Вопрос про формат работы на прошлом месте (офис, гибрид, удалённо, смешанный)",
    "  закрывай по APPLICANT NOTES или резюме; не путай с готовностью работать в офисе сейчас.",
    "- Вопрос про причину ухода с прошлого места закрывай только по APPLICANT NOTES",
    "  или резюме; если причины нет — needsHuman=true, не выдумывай.",
    "- Вопрос про зарплату всегда закрывай конкретной цифрой: сначала число из",
    "  APPLICANT NOTES или резюме, затем середина вилки вакансии. Если числа нет",
    "  нигде, назови среднюю рыночную сумму для роли и грейда, а не нижнюю границу,",
    "  и напиши «от N». Уклончивый ответ без цифры запрещён: не пиши «обсужу на",
    "  собеседовании», «по итогам интервью», «зависит от задач».",
    "  Не используй знак рубля: рубли подразумеваются по умолчанию.",
    "- Не используй Markdown, списки, заголовки, эмодзи и длинные тире.",
    "",
    "Верни строго JSON-массив без Markdown и комментариев:",
    ANSWERS_SHAPE.ru,
    "Все поля обязательны. answer не бывает пустым; для задач на код верни",
    "рабочее решение в answer без Markdown и без ```."
  ].join("\n"),
  en: [
    "You fill in an employer questionnaire on hh.ru before applying.",
    "The questionnaire is an application form, not an exam; there is no timer.",
    "",
    "Trusted sources:",
    "1. VACANCY — the role, its requirements and conditions.",
    "2. RESUME — the full resume text.",
    "3. APPLICANT NOTES — what the applicant added for this application.",
    "",
    "Rules:",
    "- Answer EVERY question in QUESTIONS. Do not skip questions or reorder them.",
    "- Write in the first person, concretely and briefly: one to four sentences.",
    "- Copy the question text into the question field exactly as written.",
    "- Do not invent experience, companies, education, salary, relocation readiness",
    "  or other facts absent from RESUME and APPLICANT NOTES.",
    "- Exception to the no-invention rule: a question about using a program,",
    "  technology, tool or service (\"Have you used X?\", \"Have you worked with X?\",",
    "  \"Are you familiar with X?\") is always answered \"Yes\", even when X is absent",
    "  from RESUME and APPLICANT NOTES.",
    "- When there is no data for an answer, give the most plausible answer,",
    "  set low confidence and needsHuman=true. Never leave a question empty.",
    "- Never write in an answer that something is missing from the resume, not",
    "  listed in the resume, or that information is unavailable. If data is absent,",
    "  set needsHuman=true but do not tell the employer the resume lacks it.",
    "- Do not use em or en dashes (—, –) in answers. For ranges write \"from … to …\"",
    "  or use a plain hyphen: 400-700.",
    "- A question about the work format at the previous job (office, hybrid, remote,",
    "  mixed) is answered from APPLICANT NOTES or the resume; do not confuse it with",
    "  readiness to work in an office now.",
    "- A question about the reason for leaving the previous job is answered only from",
    "  APPLICANT NOTES or the resume; if the reason is absent, set needsHuman=true.",
    "- A salary question is always answered with a concrete number: first a number",
    "  from APPLICANT NOTES or the resume, then the middle of the vacancy range.",
    "  If there is no number anywhere, name the average market salary for the role",
    "  and seniority, not the lower bound, and write \"from N\". An evasive answer",
    "  without a number is forbidden: no \"I will discuss it at the interview\",",
    "  \"it depends on the tasks\" or \"I am guided by the market\".",
    "  Do not use a currency sign: the local currency is implied.",
    "- No Markdown, lists, headings, emoji or long dashes.",
    "",
    "Return strict JSON without Markdown or comments:",
    ANSWERS_SHAPE.en,
    "Every field is required. answer is never empty; for coding tasks return",
    "working code in answer without Markdown and without ```."
  ].join("\n")
}

const questionsBlock = (questions: ReadonlyArray<string>): string =>
  questions.map((question, index) => `${index + 1}. ${text(question)}`).join("\n")

export const buildAnswersPrompt = (input: AnswersPromptInput): WritingPrompt => {
  const language = resolveLanguage(input.language, vacancyHaystack(input.vacancy))

  const user = [
    `LANGUAGE: ${language}${language === "ru" ? " (отвечай по-русски)" : " (answer in English)"}`,
    "",
    vacancyBlock(language, input.vacancy),
    "",
    resumeBlock(language, input.resumeText),
    "",
    "QUESTIONS:",
    questionsBlock(input.questions) || "- none",
    "",
    applicantNotesBlock(language, input.notes),
    "",
    language === "ru"
      ? "Ответь на все вопросы и верни только JSON-массив по схеме. Без Markdown и комментариев."
      : "Answer every question and return only the JSON array in the given shape. No Markdown, no comments."
  ].join("\n")

  return {
    system: ANSWERS_SYSTEM[language],
    user,
    language,
    promptVersion: ANSWERS_PROMPT_VERSION
  }
}

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
