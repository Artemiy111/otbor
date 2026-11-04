/**
 * Deterministic detectors for Russian vacancy text: cover letter requests,
 * "attach to your response" requests, working conditions and red flags.
 *
 * Pure and conservative: it is better to miss a doubtful phrase than to record
 * "no overtime" as overtime or "unpaid test" as paid. Every fact carries the
 * quoted sentence it came from.
 */
import type {
  ApplicationRequest,
  ApplicationRequestCode,
  RedFlag,
  RedFlagCode,
  VacancyConditions,
  VacancyTextFacts
} from "@otbor/contract"
import { collapseWhitespace } from "./text.ts"

type OvertimePolicy = NonNullable<VacancyConditions["overtime"]>
type BusinessTripsPolicy = NonNullable<VacancyConditions["businessTrips"]>
type TestTaskPolicy = NonNullable<VacancyConditions["testTask"]>
type EnglishLevel = NonNullable<VacancyConditions["englishLevel"]>

/** Max characters of a quoted sentence kept as evidence. */
const EVIDENCE_LIMIT = 280

const truncateEvidence = (sentence: string): string =>
  sentence.length <= EVIDENCE_LIMIT ? sentence : `${sentence.slice(0, EVIDENCE_LIMIT - 1).trimEnd()}…`

export const RED_FLAG_ORDER: ReadonlyArray<RedFlagCode> = [
  "no_contract",
  "job_scam",
  "salary_in_cash",
  "unpaid_test",
  "probation_unpaid",
  "overtime",
  "work_24_7",
  "night_shifts",
  "weekend_work",
  "fines",
  "stress",
  "multitasking",
  "age_limit",
  "gender_limit"
]

/* ----------------------------- cover letter ------------------------------ */

/** Упоминание сопроводительного письма в любом падеже. */
const LETTER_RE = /(?:сопроводительн(?!\p{L}*\s+документ)\p{L}*|cover(?:ing)?\s+letter)/iu;

/**
 * Просьба или требование что-то сделать с письмом.
 * Сюда попадают и явные требования, и просьбы «укажите», «расскажите».
 */
const REQUEST_RE =
  /(?:обязательн\p{L}*|необходим\p{L}*|требу(?:ется|ются|йте|ет|ем|емый|емая|емые)?|просьб\p{L}*|просим|пожалуйста|укаж\p{L}*|указ\p{L}*|напиш\p{L}*|опиш\p{L}*|ответь\p{L}*|расскаж\p{L}*|прилож\p{L}*|прикреп\p{L}*|пришл\p{L}*|добав\p{L}*|отправ\p{L}*|упомян\p{L}*|не\s+(?:будет\s+)?рассм\p{L}*|рассматрива\p{L}*\s+не\s+буд\p{L}*|при\s+отклике|во\s+вложении|важн\p{L}*|нужно|только\s+с|жд[её]м|присыла\p{L}*|хотим|услови\p{L}*|please|required?|must|attach\p{L}*|include|send|mention|describe)/iu;

/** Явные формулировки «письмо не нужно»: такие вакансии не помечаем. */
const NEGATION_RE =
  /(?:не\s+обязательн\p{L}*|необязательн\p{L}*|не\s+требу(?:ется|ются|ется)?|не\s+нужн\p{L}*|не\s+надо|не\s+(?:присыла|прикладыва|прикрепля)\p{L}*|можно\s+не\s+(?:писать|прикладывать|отправлять)|можно\s+без|нет\s+(?:требовани|необходимост)\p{L}*|без\s+необходимост\p{L}*|не\s+просим|не\s+приветству\p{L}*|not\s+required|optional)/iu;

export interface CoverLetterSignal {
  requested: boolean
  evidence: string | null
}

const splitSentences = (text: string): Array<string> =>
  text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => collapseWhitespace(sentence))
    .filter(Boolean)

/** The vacancy text asks for (or demands) a cover letter. */
export const detectCoverLetter = (text: string | null | undefined): CoverLetterSignal => {
  if (!text) return { requested: false, evidence: null }
  for (const sentence of splitSentences(text)) {
    if (!LETTER_RE.test(sentence)) continue
    if (NEGATION_RE.test(sentence)) continue
    if (!REQUEST_RE.test(sentence)) continue
    return { requested: true, evidence: truncateEvidence(sentence) }
  }
  return { requested: false, evidence: null }
}

/* -------------------------- application requests ------------------------- */

const APPLICATION_REQUEST_ORDER: ReadonlyArray<ApplicationRequestCode> = [
  "github",
  "portfolio",
  "code_samples",
  "about_me",
  "motivation"
]

/** Сколько следующих непустых строк наследует контекст «к отклику приложите:». */
const REQUEST_CONTEXT_LINES = 8;

/** Повелительные формы, которыми просят что-то сделать с откликом. */
const IMPERATIVE =
  String.raw`(?:приложи(?:те|ть)?|прикрепи(?:те|ть)?|пришли(?:те|ть)?|присылай(?:те)?|добавь(?:те)?|оставь(?:те)?|укажи(?:те)?|расскажи(?:те)?|напиши(?:те)?|подели(?:те)?сь|покажи(?:те)?|заполни(?:те)?|ответь(?:те)?)(?![А-Яа-яЁёA-Za-z])`;

/** Фразы, открывающие блок «что приложить к отклику». */
const ATTACH_CONTEXT_RE = new RegExp(
  [
    String.raw`к\s+(?:отклику|резюме)`,
    String.raw`при\s+отклике`,
    String.raw`в\s+отклике`,
    String.raw`в\s+сопроводительн\p{L}*`,
    String.raw`дополнительн\p{L}*\s+инструкц\p{L}*`,
    String.raw`будем\s+(?:признательн\p{L}*|рад\p{L}*)`,
    String.raw`просим`,
    String.raw`просьба`,
    String.raw`будет\s+(?:плюсом|преимуществом)`,
    IMPERATIVE,
    String.raw`\b(?:attach|send|include|share|provide|link\s+to)\b`,
  ].join("|"),
  "iu",
);


/**
 * Строки, которые сами по себе просят приложить: «портфолио» вне контекста
 * вакансии почти всегда значит «покажите работы», а не описание процесса.
 */
const SELF_TRIGGER_RE =
  /(?:портфолио|portfolio|ссылк\p{L}*\s+на\s+(?:github|gitlab|bitbucket|портфолио|portfolio|репозитори\p{L}*|профил\p{L}*|облак\p{L}*)|link\s+to\s+(?:your\s+)?(?:github|gitlab|portfolio))/iu;

/** Заголовок нового раздела: контекст «к отклику» на нём заканчивается. */
const SECTION_HEADING_RE =
  /^(?:обязанности|требования|условия|задачи|технологии|стек|о\s+компании|о\s+нас|ключевые\s+навыки|мы\s+предлагаем|бонусы|плюшки)(?![А-Яа-яЁё])/iu;

interface ApplicationRequestRule {
  code: ApplicationRequestCode;
  re: RegExp;
}

const APPLICATION_REQUEST_RULES: ReadonlyArray<ApplicationRequestRule> = [
  {
    code: "github",
    re: /(?:github|gitlab|bitbucket|гитхаб\p{L}*|гитлаб\p{L}*|битбакет\p{L}*|репозитори\p{L}*|(?<![A-Za-z])repo(?:sitory)?(?![A-Za-z]))/iu,
  },
  {
    code: "portfolio",
    re: /(?:портфолио|portfolio)/iu,
  },
  {
    code: "code_samples",
    re: new RegExp(
      [
        // «примеры своих Helm chart'ов», «примеры кода/конфигов/проектов»
        String.raw`пример\p{L}*\s+(?:\p{L}+\s+){0,2}(?:код\p{L}*|конфиг\p{L}*|чарт\p{L}*|проект\p{L}*|работ\p{L}*|скрипт\p{L}*|манифест\p{L}*|helm\p{L}*|docker\p{L}*)`,
        String.raw`helm[\s-]*charts?`,
        String.raw`docker[\s-]*(?:configs?|конфиг\p{L}*|файл\p{L}*)`,
        String.raw`code\s*samples?`,
        String.raw`pet[\s-]?projects?`,
        String.raw`пет[\s-]?проект\p{L}*`,
      ].join("|"),
      "iu",
    ),
  },
  {
    code: "about_me",
    re: new RegExp(
      [
        String.raw`рассказ\p{L}*\s+(?:о|про)\s+себе`,
        String.raw`расскаж\p{L}*\s+(?:о|про)\s+себе`,
        String.raw`о\s+себе\s+в\s+свободной\s+форме`,
        String.raw`(?:пар[ауы]|несколько)\s+слов\s+(?:о|про)\s+себе`,
        String.raw`about\s+(?:yourself|me)`,
        String.raw`self[\s-]introduction`,
      ].join("|"),
      "iu",
    ),
  },
  {
    code: "motivation",
    re: new RegExp(
      [
        String.raw`что\s+(?:вас\s+)?зацепил\p{L}*`,
        String.raw`почему\s+(?:вы\s+)?(?:хотите|выбрали|откликнул\p{L}*|заинтересовал\p{L}*)`,
        String.raw`почему\s+(?:именно\s+)?(?:наша\s+компания|эта\s+вакансия|мы)(?![А-Яа-яЁё])`,
        String.raw`чем\s+(?:вас\s+)?заинтересовал\p{L}*`,
        String.raw`(?<![А-Яа-яЁё])мотивац\p{L}*`,
        String.raw`why\s+(?:do\s+you\s+want|us|this)`,
      ].join("|"),
      "iu",
    ),
  },
];

/** Requests to attach or tell something in the response (links, samples, motivation). */
export const detectApplicationRequests = (text: string | null | undefined): Array<ApplicationRequest> => {
  if (!text) return []
  const found = new Map<ApplicationRequestCode, string>()
  let contextLeft = 0

  for (const rawLine of text.split("\n")) {
    const line = collapseWhitespace(rawLine)
    if (!line) continue

    if (SECTION_HEADING_RE.test(line.replace(/:$/, ""))) {
      contextLeft = 0
      continue
    }

    const opensContext = ATTACH_CONTEXT_RE.test(line) || SELF_TRIGGER_RE.test(line)
    const active = opensContext || contextLeft > 0
    if (opensContext) contextLeft = REQUEST_CONTEXT_LINES
    else if (contextLeft > 0) contextLeft -= 1

    if (!active) continue
    if (NEGATION_RE.test(line)) continue

    for (const rule of APPLICATION_REQUEST_RULES) {
      if (found.has(rule.code)) continue
      if (!rule.re.test(line)) continue
      found.set(rule.code, truncateEvidence(line))
    }
  }

  return APPLICATION_REQUEST_ORDER.flatMap((code) => {
    const evidence = found.get(code)
    return evidence === undefined ? [] : [{ code, evidence }]
  })
}

/* ------------------------------- conditions ------------------------------ */

const PROBATION_NEGATIVE_RE =
  /(?:без|нет|не\s+(?:будет|предусмотрен\p{L}*|устанавлива\p{L}*))\s+(?:\p{L}+\s+){0,3}испытательн\p{L}*/iu;
const PROBATION_RE = /испытательн\p{L}*/iu;
const PROBATION_MONTHS_RE = /испытательн\p{L}*[^.!?\n]{0,40}?(\d{1,2})\s*(?:мес|месяц)/iu;
const PROBATION_MONTHS_BEFORE_RE = /(\d{1,2})\s*(?:мес|месяц)\p{L}*\s+испытательн/iu;
const PROBATION_PAID_RE =
  /(?:испытательн\p{L}*[^.!?\n]{0,40}?(?:оплачива\p{L}*|с\s+оплатой)|оплачиваем\p{L}*\s+испытательн)/iu;
const PROBATION_UNPAID_RE =
  /(?:испытательн\p{L}*[^.!?\n]{0,40}?(?:не\s+оплачива\p{L}*|без\s+оплаты)|неоплачиваем\p{L}*\s+испытательн)/iu;

const ON_CALL_RE =
  /(?:on[-\s]?call|дежурств\p{L}*|дежурн\p{L}*\s+(?:смен|график|раз|ноч)|поддержк\p{L}*\s+(?:24\/7|круглосуточн\p{L}*)|24\/7|круглосуточн\p{L}*\s+(?:поддержк|доступност)|доступност\p{L}*\s+вне\s+рабоч\p{L}*\s+врем\p{L}*|ночн\p{L}*\s+(?:смен|звонк|дежурств))/iu;
const ON_CALL_NEGATIVE_RE =
  /(?:без|нет|не\s+(?:будет|предусмотрен\p{L}*|требу\p{L}*|практику\p{L}*))\s+(?:\p{L}+\s+){0,3}(?:дежурств|on[-\s]?call|ночн\p{L}*\s+смен)/iu;

const OVERTIME_RE =
  /(?:переработк\p{L}*|сверхурочн\p{L}*|ненормированн\p{L}*\s+(?:рабоч\p{L}*\s+)?день|работ\p{L}*\s+в\s+выходн\p{L}*|работ\p{L}*\s+по\s+выходн\p{L}*)/iu;
const OVERTIME_NONE_RE =
  /(?:без|нет|не\s+(?:будет|предусмотрен\p{L}*|практику\p{L}*))\s+(?:\p{L}+\s+){0,3}(?:переработ|сверхурочн)/iu;
const OVERTIME_PAID_RE =
  /(?:переработк|сверхурочн)\p{L}*[^.!?\n]{0,50}(?:оплачива\p{L}*|компенсир\p{L}*|отгул\p{L}*)/iu;
const OVERTIME_UNPAID_RE =
  /(?:переработк|сверхурочн)\p{L}*[^.!?\n]{0,50}(?:не\s+оплачива\p{L}*|без\s+оплаты|не\s+компенсир\p{L}*)/iu;

const TRIPS_RE =
  /(?:командировк\p{L}*|разъездн\p{L}*|поездк\p{L}*\s+по\s+объект|мобильн\p{L}*\s+характер)/iu;
const TRIPS_NONE_RE =
  /(?:без|нет|не\s+(?:будет|предусмотрен\p{L}*|требу\p{L}*))\s+(?:\p{L}+\s+){0,3}(?:командиров|поездок|разъезд)/iu;
const TRIPS_PERCENT_RE =
  /(?:до\s+)?(\d{1,2})\s*%\s*(?:командиров|поездок)|(?:командировк|поездк)\p{L}*[^.!?\n]{0,20}?(?:до\s+)?(\d{1,2})\s*%/iu;
const TRIPS_FREQUENT_RE = /(?:част\p{L}*\s+командиров|много\s+командиров|постоянн\p{L}*\s+командиров)/iu;

const ENGLISH_LEVEL_RE =
  /(?:английск\p{L}*|English)[^.!?\n]{0,40}?\b(A1|A2|B1|B2|C1|C2|beginner|elementary|pre[-\s]?intermediate|intermediate|upper[-\s]?intermediate|advanced|fluent|native)\b/iu;
const ENGLISH_LEVEL_BEFORE_RE =
  /\b(A1|A2|B1|B2|C1|C2)\b[^.!?\n]{0,30}?(?:английск|English)/iu;
const ENGLISH_FREE_RE =
  /(?:свободн\p{L}*\s+английск\p{L}*|английск\p{L}*\s+свободн\p{L}*|fluent\s+english)/iu;
const ENGLISH_CONV_RE =
  /(?:разговорн\p{L}*\s+английск\p{L}*|английск\p{L}*\s+разговорн\p{L}*)/iu;
const ENGLISH_NOT_REQUIRED_RE =
  /(?:английск\p{L}*|English)[^.!?\n]{0,40}(?:не\s+требу\p{L}*|не\s+нужен|не\s+обязательн\p{L}*)|(?:без\s+английск\p{L}*)/iu;
const ENGLISH_PREFERRED_RE =
  /(?:английск\p{L}*|English)[^.!?\n]{0,40}(?:будет\s+плюсом|плюс\p{L}*|желательн\p{L}*)/iu;

const TEST_TASK_RE =
  /(?:тестов\p{L}*\s+задани\p{L}*|test\s+task|домашн\p{L}*\s+задани\p{L}*|выполнить\s+тестов\p{L}*)/iu;
const TEST_TASK_NONE_RE =
  /(?:без|нет|не\s+(?:будет|предусмотрен\p{L}*|требу\p{L}*))\s+(?:\p{L}+\s+){0,3}(?:тестов\p{L}*\s+задани|test\s+task)/iu;
const TEST_TASK_UNPAID_RE =
  /(?:тестов\p{L}*\s+задани\p{L}*|test\s+task|тестовое)[^.!?\n]{0,40}(?:не\s+оплачива\p{L}*|бесплатн\p{L}*)|неоплачиваем\p{L}*\s+(?:тестов|задани)/iu;
const TEST_TASK_PAID_RE =
  /(?:тестов\p{L}*\s+задани\p{L}*|test\s+task|тестовое)[^.!?\n]{0,40}(?:оплачива\p{L}*|платн\p{L}*)|оплачиваем\p{L}*\s+(?:тестов|задани)/iu;

const STAGES_AFTER_RE =
  /(?<count>\d{1,2}|один|одна|одного|одной|два|две|двух|три|трех|трёх|четыре|четырех|четырёх|пять|пяти|шесть|шести)\s*(?:этап\p{L}*|интервью|собеседован\p{L}*)/iu;
const STAGES_BEFORE_RE =
  /(?:этап\p{L}*|интервью|собеседован\p{L}*)[^.!?\n]{0,20}?(?<count>\d{1,2}|один|одна|одного|одной|два|две|двух|три|трех|трёх|четыре|четырех|четырёх|пять|пяти|шесть|шести)/iu;

const OFFICIAL_RE =
  /(?:официальн\p{L}*\s+(?:трудоустройств\p{L}*|оформлен\p{L}*)|по\s+ТК\s+РФ|трудов\p{L}*\s+договор\p{L}*|бел\p{L}*\s+зарплат\p{L}*|полностью\s+бел\p{L}*)/iu;
const OFFICIAL_NEGATIVE_RE =
  /(?:без\s+оформлен\p{L}*|неофициальн\p{L}*|сер\p{L}*\s+зарплат\p{L}*|зарплат\p{L}*\s+в\s+конверте|в\s+конверте|наличн\p{L}*\s+(?:зарплат|оплат))/iu;

const CITIZENSHIP_RE =
  /(?:гражданств\p{L}*\s+(?:РФ|России|Российской\s+Федерации)|только\s+граждан\p{L}*\s+(?:РФ|России)|гражданство\s+обязательн\p{L}*)/iu;
const CITIZENSHIP_NEGATIVE_RE =
  /(?:гражданств\p{L}*\s+не\s+требу\p{L}*|без\s+ограничен\p{L}*\s+по\s+гражданств\p{L}*|независимо\s+от\s+гражданств\p{L}*)/iu;

const VACATION_DAYS_RE =
  /отпуск\p{L}*[^.!?\n]{0,30}?(\d{1,2})\s*(?:календарн\p{L}*\s+)?дн\p{L}*|(\d{1,2})\s*(?:календарн\p{L}*\s+)?дн\p{L}*\s+отпуск\p{L}*/iu;

const SICK_PAID_RE =
  /(?:оплачиваем\p{L}*\s+больничн\p{L}*|больничн\p{L}*\s+оплачива\p{L}*|100\s*%\s*(?:оплата\s+)?больничн\p{L}*)/iu;
const SICK_UNPAID_RE =
  /(?:больничн\p{L}*\s+не\s+оплачива\p{L}*|без\s+оплаты\s+больничн\p{L}*)/iu;

interface RedFlagRule {
  readonly code: RedFlagCode
  readonly re: RegExp
  /** "No overtime" is the absence of the flag, not the flag. */
  readonly negated?: boolean
  /** Context that cancels the signal. */
  readonly unless?: RegExp
}

/** «Не за счёт кандидата», «без вложений» — не job scam. */
const JOB_SCAM_UNLESS_RE =
  /(?:не\s+за\s+счёт\s+(?:кандидат|сотрудник|соискател|свой)|без\s+(?:вложений|взносов)|не\s+(?:требу\p{L}*|берём\p{L}*|берем\p{L}*)\s+(?:оплат|взнос|залог|депозит))/iu;

const RED_FLAG_RULES: ReadonlyArray<RedFlagRule> = [
  {
    code: "unpaid_test",
    re: /(?:неоплачиваем\p{L}*\s+(?:тестов\p{L}*|задани\p{L}*)|(?:тестов\p{L}*\s+задани\p{L}*|тестовое)[^.!?\n]{0,40}(?:не\s+оплачива\p{L}*|бесплатн\p{L}*))/iu,
  },
  {
    code: "overtime",
    re: /(?:переработк\p{L}*|сверхурочн\p{L}*|ненормированн\p{L}*\s+(?:рабоч\p{L}*\s+)?день)/iu,
    negated: true,
  },
  {
    code: "stress",
    re: /(?:стрессоустойчив\p{L}*|стрессов\p{L}*\s+(?:сред|услови|работ))/iu,
    negated: true,
  },
  {
    code: "multitasking",
    re: /(?:многозадачн\p{L}*|много\s+задач\s+одновременно)/iu,
  },
  {
    code: "work_24_7",
    re: /(?:24\/7|круглосуточн\p{L}*\s+(?:поддержк|работ|режим))/iu,
    negated: true,
  },
  {
    code: "fines",
    re: /(?:штраф\p{L}*|удержан\p{L}*)/iu,
    negated: true,
  },
  {
    code: "no_contract",
    re: /(?:без\s+оформлен\p{L}*|без\s+трудов\p{L}*\s+договор\p{L}*|неофициальн\p{L}*\s+(?:трудоустройств|работ))/iu,
  },
  {
    code: "job_scam",
    re: /(?:вступительн\p{L}*\s+взнос\p{L}*|стартов\p{L}*\s+взнос\p{L}*|взнос\p{L}*\s+за\s+(?:трудоустройств\p{L}*|работ\p{L}*)|плат\p{L}*\s+за\s+трудоустройств\p{L}*)/iu,
    negated: true,
    unless: JOB_SCAM_UNLESS_RE,
  },
  {
    code: "job_scam",
    re: /(?:залог\p{L}*\s+за\s+(?:оборудован\p{L}*|техник\p{L}*|ноутбук\p{L}*|форм\p{L}*|обучени\p{L}*|трудоустройств\p{L}*)|депозит\p{L}*\s+за\s+(?:работ\p{L}*|доступ\p{L}*|оборудован\p{L}*|техник\p{L}*))/iu,
    negated: true,
    unless: JOB_SCAM_UNLESS_RE,
  },
  {
    code: "job_scam",
    re: /(?:покупк\p{L}*\s+(?:оборудован\p{L}*|техник\p{L}*|стартов\p{L}*\s+набор\p{L}*|форм\p{L}*|сим-?карт\p{L}*)[^.!?\n]{0,50}?(?:за\s+свой\s+счёт|самостоятельно|кандидат\p{L}*|сотрудник\p{L}*)|оплат\p{L}*\s+доступа\s+к\s+(?:баз\p{L}*|заказ\p{L}*|клиент\p{L}*)|выкуп\p{L}*\s+заказ\p{L}*)/iu,
    negated: true,
    unless: JOB_SCAM_UNLESS_RE,
  },
  {
    code: "job_scam",
    re: /(?:(?:обучени\p{L}*|стажировк\p{L}*|курс\p{L}*|оборудован\p{L}*|техник\p{L}*|форм\p{L}*|сим-?карт\p{L}*|медосмотр\p{L}*|медкомисси\p{L}*)[^.!?\n]{0,50}?за\s+счёт\s+(?:кандидат\p{L}*|сотрудник\p{L}*|соискател\p{L}*|свой|собственн\p{L}*)|(?:кандидат\p{L}*|сотрудник\p{L}*|соискател\p{L}*)\p{L}*\s+оплачива\p{L}*\s+(?:обучени\p{L}*|стажировк\p{L}*|курс\p{L}*|оборудован\p{L}*|техник\p{L}*|медосмотр\p{L}*))/iu,
    negated: true,
    unless: JOB_SCAM_UNLESS_RE,
  },
  {
    code: "job_scam",
    re: /(?:(?<![А-Яа-яЁё])платн\p{L}*\s+(?:обучени\p{L}*|стажировк\p{L}*|курс\p{L}*)|оплат\p{L}*\s+(?:обучени\p{L}*|стажировк\p{L}*|курс\p{L}*)\s+(?:до\s+трудоустройств\p{L}*|перед\s+началом\s+работ\p{L}*|с\s+последующим\s+возврат\p{L}*)|возврат\p{L}*\s+(?:обучени\p{L}*|курс\p{L}*)\s+после\s+трудоустройств\p{L}*)/iu,
    negated: true,
    unless: JOB_SCAM_UNLESS_RE,
  },
  {
    code: "age_limit",
    re: /(?:возраст\p{L}*\s+до\s+\d{2}|до\s+\d{2}\s+лет|не\s+старше\s+\d{2})/iu,
  },
  {
    code: "gender_limit",
    re: /(?:только\s+(?:мужчин\p{L}*|женщин\p{L}*)|(?:мужчин\p{L}*|женщин\p{L}*)\s+только)/iu,
  },
  {
    code: "night_shifts",
    re: /(?:ночн\p{L}*\s+(?:смен|работ|звонк)|работа\s+ночью)/iu,
    negated: true,
  },
  {
    code: "weekend_work",
    re: /(?:работ\p{L}*\s+в\s+выходн\p{L}*|работ\p{L}*\s+по\s+выходн\p{L}*|дежурств\p{L}*\s+по\s+выходн\p{L}*|выходн\p{L}*\s+дн\p{L}*\s+рабоч\p{L}*)/iu,
    negated: true,
  },
  {
    code: "salary_in_cash",
    re: /(?:зарплат\p{L}*\s+в\s+конверте|сер\p{L}*\s+зарплат\p{L}*|наличн\p{L}*\s+(?:зарплат|оплат)|оплат\p{L}*\s+наличн\p{L}*)/iu,
  },
  {
    code: "probation_unpaid",
    re: /(?:испытательн\p{L}*[^.!?\n]{0,40}?(?:не\s+оплачива\p{L}*|без\s+оплаты)|неоплачиваем\p{L}*\s+испытательн)/iu,
  },
];

const WORD_NUMBER: Readonly<Record<string, number>> = {
  один: 1,
  одна: 1,
  одного: 1,
  одной: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трех: 3,
  трёх: 3,
  четыре: 4,
  четырех: 4,
  четырёх: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
};

interface Hit {
  readonly sentence: string
  readonly match: RegExpExecArray
}

const findHit = (sentences: ReadonlyArray<string>, re: RegExp): Hit | null => {
  for (const sentence of sentences) {
    re.lastIndex = 0
    const match = re.exec(sentence)
    if (match) return { sentence, match }
  }
  return null
}

const has = (sentences: ReadonlyArray<string>, re: RegExp): string | null =>
  findHit(sentences, re)?.sentence ?? null

const negatedBefore = (sentence: string, index: number): boolean =>
  /(?:без|нет|не)\s+(?:\p{L}+\s+){0,3}$/iu.test(sentence.slice(Math.max(0, index - 40), index))

const numberFrom = (value: string | undefined): number | null => {
  if (!value) return null
  const normalized = value.toLowerCase()
  const word = WORD_NUMBER[normalized]
  if (word !== undefined) return word
  return /^\d+$/.test(normalized) ? Number(normalized) : null
}

const normalizeEnglishLevel = (value: string): EnglishLevel => {
  const level = value.toLowerCase().replace(/\s+/g, "-")
  if (level === "a1" || level === "beginner" || level === "elementary") return "A1"
  if (level === "a2" || level === "pre-intermediate") return "A2"
  if (level === "b1" || level === "intermediate") return "B1"
  if (level === "b2" || level === "upper-intermediate") return "B2"
  return "C1"
}

const sentencesOf = (text: string | null | undefined): Array<string> => (text ? splitSentences(text) : [])

const redFlagsFrom = (sentences: ReadonlyArray<string>): Array<RedFlag> => {
  const found = new Map<RedFlagCode, string>()
  for (const sentence of sentences) {
    for (const rule of RED_FLAG_RULES) {
      if (found.has(rule.code)) continue
      rule.re.lastIndex = 0
      const match = rule.re.exec(sentence)
      if (!match) continue
      if (rule.negated && negatedBefore(sentence, match.index)) continue
      if (rule.unless?.test(sentence)) continue
      found.set(rule.code, sentence)
    }
  }
  return RED_FLAG_ORDER.flatMap((code) => {
    const sentence = found.get(code)
    return sentence === undefined ? [] : [{ code, evidence: truncateEvidence(sentence) }]
  })
}

const conditionsFrom = (
  sentences: ReadonlyArray<string>
): { readonly conditions: VacancyConditions | null; readonly overtime: OvertimePolicy | null } => {
  const evidence: Record<string, string> = {}
  const note = (key: string, sentence: string): void => {
    evidence[key] = truncateEvidence(sentence)
  }

  const probationNegative = has(sentences, PROBATION_NEGATIVE_RE)
  const probationHit = findHit(sentences, PROBATION_RE)
  let probation: boolean | null = null
  let probationMonths: number | null = null
  let probationPaid: boolean | null = null

  if (probationNegative) {
    probation = false
    note("probation", probationNegative)
  } else if (probationHit) {
    probation = true
    note("probation", probationHit.sentence)

    const months = findHit(sentences, PROBATION_MONTHS_RE) ?? findHit(sentences, PROBATION_MONTHS_BEFORE_RE)
    if (months) {
      const value = Number(months.match[1])
      if (Number.isInteger(value) && value > 0 && value <= 24) probationMonths = value
    }

    const unpaid = has(sentences, PROBATION_UNPAID_RE)
    const paid = has(sentences, PROBATION_PAID_RE)
    if (unpaid) {
      probationPaid = false
      note("probationPaid", unpaid)
    } else if (paid) {
      probationPaid = true
      note("probationPaid", paid)
    }
  }

  const onCallNegative = has(sentences, ON_CALL_NEGATIVE_RE)
  const onCallHit = has(sentences, ON_CALL_RE)
  let onCall: boolean | null = null
  if (onCallNegative) {
    onCall = false
    note("onCall", onCallNegative)
  } else if (onCallHit) {
    onCall = true
    note("onCall", onCallHit)
  }

  let overtime: OvertimePolicy | null = null
  const overtimeNone = has(sentences, OVERTIME_NONE_RE)
  const overtimeUnpaid = has(sentences, OVERTIME_UNPAID_RE)
  const overtimePaid = has(sentences, OVERTIME_PAID_RE)
  const overtimeHit = has(sentences, OVERTIME_RE)
  if (overtimeNone) {
    overtime = "none"
    note("overtime", overtimeNone)
  } else if (overtimeUnpaid) {
    overtime = "unpaid"
    note("overtime", overtimeUnpaid)
  } else if (overtimePaid) {
    overtime = "paid"
    note("overtime", overtimePaid)
  } else if (overtimeHit) {
    overtime = "possible"
    note("overtime", overtimeHit)
  }

  let businessTrips: BusinessTripsPolicy | null = null
  let businessTripsPercent: number | null = null
  const tripsNone = has(sentences, TRIPS_NONE_RE)
  const tripsHit = has(sentences, TRIPS_RE)
  if (tripsNone) {
    businessTrips = "none"
    note("businessTrips", tripsNone)
  } else if (tripsHit) {
    const percent = findHit(sentences, TRIPS_PERCENT_RE)
    const rawPercent = percent?.match[1] ?? percent?.match[2]
    if (percent && rawPercent) {
      const value = Number(rawPercent)
      if (Number.isInteger(value) && value > 0 && value <= 100) {
        businessTripsPercent = value
        businessTrips = "percent"
        note("businessTrips", percent.sentence)
      }
    }
    if (businessTrips === null) {
      businessTrips = has(sentences, TRIPS_FREQUENT_RE) ? "frequent" : "possible"
      note("businessTrips", tripsHit)
    }
  }

  let englishLevel: EnglishLevel | null = null
  let englishRequired: boolean | null = null
  const englishHit = findHit(sentences, ENGLISH_LEVEL_RE) ?? findHit(sentences, ENGLISH_LEVEL_BEFORE_RE)
  const englishFree = has(sentences, ENGLISH_FREE_RE)
  const englishConv = has(sentences, ENGLISH_CONV_RE)
  if (englishHit) {
    englishLevel = normalizeEnglishLevel(englishHit.match[1] ?? "")
    englishRequired = true
    note("english", englishHit.sentence)
  } else if (englishFree) {
    englishLevel = "C1"
    englishRequired = true
    note("english", englishFree)
  } else if (englishConv) {
    englishLevel = "B1"
    englishRequired = true
    note("english", englishConv)
  }
  const englishOptional = has(sentences, ENGLISH_NOT_REQUIRED_RE) ?? has(sentences, ENGLISH_PREFERRED_RE)
  if (englishOptional) {
    englishRequired = false
    note("english", englishOptional)
  }

  let testTask: TestTaskPolicy | null = null
  const testNone = has(sentences, TEST_TASK_NONE_RE)
  const testUnpaid = has(sentences, TEST_TASK_UNPAID_RE)
  const testPaid = has(sentences, TEST_TASK_PAID_RE)
  const testHit = has(sentences, TEST_TASK_RE)
  if (testNone) {
    testTask = "none"
    note("testTask", testNone)
  } else if (testUnpaid) {
    testTask = "unpaid"
    note("testTask", testUnpaid)
  } else if (testPaid) {
    testTask = "paid"
    note("testTask", testPaid)
  } else if (testHit) {
    testTask = "possible"
    note("testTask", testHit)
  }

  let interviewStages: number | null = null
  const stagesHit = findHit(sentences, STAGES_AFTER_RE) ?? findHit(sentences, STAGES_BEFORE_RE)
  if (stagesHit) {
    const value = numberFrom(stagesHit.match.groups?.count)
    const tailStart = stagesHit.match.index + stagesHit.match[0].length
    const tail = stagesHit.sentence.slice(tailStart, tailStart + 12)
    // "интервью 1 час" is a duration, not a number of stages.
    const duration = /(?:час|минут|дн|день|недел|месяц|%|год|лет)/iu.test(tail)
    if (!duration && value !== null && value >= 1 && value <= 10) {
      interviewStages = value
      note("interviewStages", stagesHit.sentence)
    }
  }

  let officialEmployment: boolean | null = null
  const officialNegative = has(sentences, OFFICIAL_NEGATIVE_RE)
  const officialHit = has(sentences, OFFICIAL_RE)
  if (officialNegative) {
    officialEmployment = false
    note("officialEmployment", officialNegative)
  } else if (officialHit) {
    officialEmployment = true
    note("officialEmployment", officialHit)
  }

  let citizenshipRequired: boolean | null = null
  const citizenshipNegative = has(sentences, CITIZENSHIP_NEGATIVE_RE)
  const citizenshipHit = has(sentences, CITIZENSHIP_RE)
  if (citizenshipNegative) {
    citizenshipRequired = false
    note("citizenship", citizenshipNegative)
  } else if (citizenshipHit) {
    citizenshipRequired = true
    note("citizenship", citizenshipHit)
  }

  let vacationDays: number | null = null
  const vacationHit = findHit(sentences, VACATION_DAYS_RE)
  if (vacationHit) {
    const value = Number(vacationHit.match[1] ?? vacationHit.match[2])
    if (Number.isInteger(value) && value > 0 && value <= 60) {
      vacationDays = value
      note("vacationDays", vacationHit.sentence)
    }
  }

  let sickLeavePaid: boolean | null = null
  const sickUnpaid = has(sentences, SICK_UNPAID_RE)
  const sickPaid = has(sentences, SICK_PAID_RE)
  if (sickUnpaid) {
    sickLeavePaid = false
    note("sickLeavePaid", sickUnpaid)
  } else if (sickPaid) {
    sickLeavePaid = true
    note("sickLeavePaid", sickPaid)
  }

  const hasAny =
    probation !== null ||
    onCall !== null ||
    overtime !== null ||
    businessTrips !== null ||
    englishLevel !== null ||
    englishRequired !== null ||
    testTask !== null ||
    interviewStages !== null ||
    officialEmployment !== null ||
    citizenshipRequired !== null ||
    vacationDays !== null ||
    sickLeavePaid !== null

  if (!hasAny) return { conditions: null, overtime }

  return {
    overtime,
    conditions: {
      probation,
      probationMonths,
      probationPaid,
      onCall,
      overtime,
      businessTrips,
      businessTripsPercent,
      englishLevel,
      englishRequired,
      testTask,
      interviewStages,
      officialEmployment,
      citizenshipRequired,
      vacationDays,
      sickLeavePaid,
      evidence
    }
  }
}

/**
 * Working conditions stated in the text. `null` when the text states none
 * (red flags are reported separately by `detectRedFlags`).
 */
export const detectVacancyConditions = (text: string | null | undefined): VacancyConditions | null =>
  conditionsFrom(sentencesOf(text)).conditions

/**
 * Red flags stated in the text, in a stable order. Paid or absent overtime is
 * a condition, not a red flag, so it is dropped here.
 */
export const detectRedFlags = (text: string | null | undefined): Array<RedFlag> => {
  const sentences = sentencesOf(text)
  const { overtime } = conditionsFrom(sentences)
  const flags = redFlagsFrom(sentences)
  return overtime === "paid" || overtime === "none" ? flags.filter((flag) => flag.code !== "overtime") : flags
}

export const detectVacancyTextFacts = (text: string | null | undefined): VacancyTextFacts => {
  const sentences = sentencesOf(text)
  const { conditions, overtime } = conditionsFrom(sentences)
  const flags = redFlagsFrom(sentences)
  return {
    coverLetter: detectCoverLetter(text),
    applicationRequests: detectApplicationRequests(text),
    conditions,
    redFlags: overtime === "paid" || overtime === "none" ? flags.filter((flag) => flag.code !== "overtime") : flags
  }
}
