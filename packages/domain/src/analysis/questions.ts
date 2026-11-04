/**
 * The question catalog sent to the decision model (SystemOne, `clef-flash`).
 * One source of truth: the wire request, the raw answer decoder and the
 * interpreter all read this table. Changing wording or adding a question means
 * bumping `ANALYSIS_PROMPT_VERSION`, which makes every stored analysis stale.
 */

/** Prompt version `a4`: the wording ported from the prototype, no stack questions. */
export const ANALYSIS_PROMPT_VERSION = "a4"

/** Facts with a confidence below this read as unknown. */
export const ANALYSIS_THRESHOLD = 0.8

/** Yes/no question: the model answers with the probability of "yes". */
export interface NoulQuestion {
  readonly type: "noul"
  readonly instructions: string
}

/** Pick one option: `criteria` maps option key to its description. */
export interface ChoiceQuestion {
  readonly type: "choice"
  readonly instructions: string
  readonly criteria: Readonly<Record<string, string>>
}

/** A number on a scale; `criteria[i]` describes the score `i`. */
export interface ScoreQuestion {
  readonly type: "score"
  readonly instructions: string
  readonly criteria: ReadonlyArray<string>
}

export type AnalysisQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion

const tri = (instructions: string): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria: {
    required: "explicitly required or mandatory",
    preferred: "asked or recommended but optional",
    not_mentioned: "not mentioned"
  }
})

const yn = (instructions: string): NoulQuestion => ({ type: "noul", instructions })

const LEVELS = {
  intern: "intern, trainee, student",
  junior: "junior, up to 1-2 years",
  middle: "middle, 2-4 years",
  senior: "senior, 4+ years, works independently",
  staff: "staff, principal, lead expert without direct reports",
  tech_lead: "tech lead: leads technically, no formal people management",
  team_lead: "team lead: manages people and the technical side",
  head: "head of department, director, CTO",
  unknown: "level is not stated"
} as const

/** Keys are the question ids on the wire. */
export const ANALYSIS_QUESTIONS = {
  is_it_role: yn("Is this an IT job (software, infrastructure, data, QA, IT management)?"),
  role: {
    type: "choice",
    instructions: "Which IT role family is it?",
    criteria: {
      devops: "DevOps, CI/CD, infrastructure as code",
      sre: "SRE, reliability engineering",
      platform: "platform engineering, Kubernetes platform",
      sysadmin: "system or network administrator",
      security: "information security",
      backend: "backend developer",
      frontend: "frontend developer",
      fullstack: "fullstack developer",
      mobile: "mobile developer",
      qa: "QA, test engineer",
      data: "data engineer, data scientist, ML",
      analyst: "business or system analyst",
      dba: "database administrator",
      support: "technical support",
      manager: "project, product or delivery manager",
      other: "anything else"
    }
  },
  title_level: {
    type: "choice",
    instructions:
      "Which level does the job TITLE state? Words: стажёр=intern; junior; middle; senior or ведущий=senior; ведущий эксперт=staff; руководитель группы or тимлид=team_lead; руководитель отдела or директор=head.",
    criteria: LEVELS
  },
  required_level: {
    type: "choice",
    instructions:
      "Judging by required years of experience and responsibilities (not only the title), which level is really required? 3+ years usually means middle, 5+ years or full ownership of architecture means senior.",
    criteria: LEVELS
  },
  years_min: {
    type: "score",
    instructions: "Minimum years of experience required",
    criteria: ["none stated", "1 year", "2 years", "3 years", "4 years", "5 years", "6 or more years"]
  },
  company_type: {
    type: "choice",
    instructions:
      "Read the section about the employer. What kind of company is it? Outstaff means engineers work inside a client team; outsource means the company delivers projects for clients; product means it develops and runs its own product.",
    criteria: {
      product: "builds and runs its own product or service",
      outsource: "studio or agency delivering projects for external clients",
      outstaff: "places its engineers into a client company team (outstaff, staffing)",
      integrator: "system integrator",
      consulting: "consulting",
      bank_fintech: "bank, insurance or fintech",
      government: "state or municipal organization",
      startup: "early-stage startup",
      recruiter: "recruitment agency",
      unknown: "cannot tell from the text"
    }
  },
  work_mode: {
    type: "choice",
    instructions: "Work format described in the text",
    criteria: {
      remote: "fully remote",
      hybrid: "hybrid",
      office: "office only",
      unspecified: "not stated"
    }
  },
  employment: {
    type: "choice",
    instructions: "Employment form",
    criteria: {
      labor_code: "official employment under labor code",
      contractor: "self-employed, GPH, IP or contract",
      unspecified: "not stated"
    }
  },
  req_cover_letter: tri(
    "Does the vacancy ask applicants to write a cover letter or a free-form message about themselves together with the application (for example: 'в сопроводительном письме', 'в отклике расскажите', 'приложите к отклику')?"
  ),
  req_repo: tri(
    "Does the vacancy ask applicants to send a link to THEIR OWN code: GitHub or GitLab profile, pet projects, code samples? Mentioning GitHub, GitLab or Git as a tool used in the job does NOT count."
  ),
  req_portfolio: tri("Does the vacancy ask for a portfolio, examples of work or pet projects?"),
  req_answers_in_reply: tri(
    "Does the vacancy list specific questions that applicants must answer in the application (numbered questions, salary, availability, experience with X)?"
  ),
  req_contact_outside: tri(
    "Does the vacancy ask applicants to write to Telegram, email or phone instead of or besides responding on the site?"
  ),
  req_external_form: tri(
    "Does the vacancy ask applicants to fill an external form, record a video or pass an online test before applying?"
  ),
  req_salary_expectation: tri("Does the vacancy ask applicants to state salary expectations in the response?"),
  test_task: {
    type: "choice",
    instructions:
      "Does the hiring process include a test assignment (тестовое задание) that the candidate does before an offer? Choose unpaid or paid ONLY if the text says so explicitly; if a test assignment is mentioned without any word about payment choose unspecified. Testing as a job duty and paid internships do NOT count.",
    criteria: {
      none: "no test assignment mentioned",
      paid: "test assignment explicitly paid",
      unpaid: "test assignment explicitly unpaid",
      unspecified: "test assignment mentioned, payment not stated"
    }
  },
  internship: {
    type: "choice",
    instructions: "Is this an internship or trainee program, and is it paid?",
    criteria: {
      not_internship: "regular job, not an internship",
      paid: "paid internship",
      unpaid: "unpaid internship",
      unspecified: "internship, payment not stated"
    }
  },
  manages_people: yn(
    "Will the employee manage people (direct reports, team leadership)? A product or project owner who leads a team counts."
  ),
  english: {
    type: "choice",
    instructions: "Is English required?",
    criteria: {
      required: "English required",
      preferred: "English is a plus",
      not_mentioned: "not mentioned"
    }
  },
  location_requirement: {
    type: "choice",
    instructions: "Where must the employee be located?",
    criteria: {
      any: "no location requirement or fully remote from anywhere",
      city_or_country: "must live in or near a specific city or country, or visit an office",
      relocation_help: "company offers or requires relocation",
      unspecified: "not stated"
    }
  },
  citizenship_required: yn("Is a specific citizenship required?"),
  on_call: yn(
    "Is the employee expected to be on duty outside working hours (on-call, дежурство по графику)? Marketing claims like 'service works 24/7' do NOT count."
  ),
  night_or_weekend: yn(
    "Is the employee expected to work night shifts or weekends? Marketing claims like 'service works 24/7' do NOT count."
  ),
  overtime: yn(
    "Does the text say the employee works overtime or irregular hours (ненормированный график, переработки)? Marketing claims like 'service works 24/7' do NOT count."
  ),
  business_trips: yn("Does the job include business trips?"),
  probation: yn("Is there a probation period?"),
  probation_unpaid_or_reduced: yn("Is the probation period unpaid or paid at a reduced rate?"),
  salary_in_text: yn("Is a salary amount stated in the description text?"),
  bonus: yn("Are bonuses or performance pay mentioned?"),
  health_insurance: yn("Is health insurance (DMS) offered?"),
  education_budget: yn("Is a budget for education, conferences or courses offered?"),
  solo_role: yn(
    "Does the text say the candidate will be the first or the only engineer of this kind in the company?"
  ),
  relocation_required: yn("Does the job require the employee to relocate to another city or country?"),
  redflag_stress: yn("Does the text demand stress resistance or work in a fast, high-pressure environment?"),
  redflag_multitask: yn(
    "Does the job combine duties of clearly different professions (for example admin plus developer plus support plus procurement)?"
  ),
  redflag_scam: yn("Does the vacancy look like a scam or require an upfront payment?"),
  redflag_discrimination: yn("Does the vacancy restrict applicants by age or gender?")
} as const satisfies Record<string, AnalysisQuestion>

export type AnalysisQuestionId = keyof typeof ANALYSIS_QUESTIONS
