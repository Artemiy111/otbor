import type { Seniority } from "@otbor/contract"
import { normalizeText } from "./text.ts"

/**
 * Правила для заголовка. Порядок определяет приоритет: сначала руководство,
 * затем ведущие роли и только потом «обычные» грейды. Более конкретная роль
 * перебивает менее конкретную: «Team Lead» — это team_lead, а не tech_lead;
 * «ведущий эксперт» — это staff, а не senior.
 */
const TITLE_RULES: ReadonlyArray<{ readonly grade: Seniority; readonly pattern: RegExp }> = [
  // «Руководитель группы» — это team_lead, поэтому это правило идёт раньше head.
  {
    grade: "team_lead",
    pattern:
      /(?<![\p{L}\p{N}_])(?:тим-?лид\p{L}*|team\s*lead|teamlead|руководител\p{L}*[^!?.,;:]{0,40}?(?:групп\p{L}*|команд\p{L}*))(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "head",
    pattern:
      /(?<![\p{L}\p{N}_])(?:head(?:\s+of)?|chief|cto|ceo|cfo|coo|vp|директор\p{L}*|начальник\p{L}*|руководител\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "tech_lead",
    pattern:
      /(?<![\p{L}\p{N}_])(?:тех-?лид\p{L}*|tech\s*lead|techlead|техническ\p{L}*\s+лидер\p{L}*|лидер\p{L}*|\blead\b)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "staff",
    pattern:
      /(?<![\p{L}\p{N}_])(?:principal|staff|архитектор\p{L}*|ведущ\p{L}*\s+эксперт\p{L}*|главн\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "senior",
    pattern: /(?<![\p{L}\p{N}_])(?:senior|сеньор\p{L}*|ведущ\p{L}*|старш\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "middle",
    pattern: /(?<![\p{L}\p{N}_])(?:middle|мидл\p{L}*|средн\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  // «стажёр» точнее «младший», поэтому он проверяется раньше.
  {
    grade: "intern",
    pattern:
      /(?<![\p{L}\p{N}_])(?:intern|trainee|стажер\p{L}*|ученик\p{L}*|помощник\p{L}*|практикант\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "junior",
    pattern:
      /(?<![\p{L}\p{N}_])(?:junior|младш\p{L}*|начинающ\p{L}*|1[ -]?я?\s*лини\p{L}*|1[ -]?й?\s*уровень|l1)(?![\p{L}\p{N}_])/iu
  }
]

/**
 * Резервный сигнал — описание. Здесь только явные названия роли и уровня:
 * «ведущий», «старший», «руководитель отдела» в тексте часто не про грейд
 * («ведущие практики», «подчиняется руководителю отдела»), поэтому в описании
 * они не считаются. Грейд берётся, только если встретился ровно один вид маркера.
 */
const BODY_RULES: ReadonlyArray<{ readonly grade: Seniority; readonly pattern: RegExp }> = [
  {
    grade: "team_lead",
    pattern: /(?<![\p{L}\p{N}_])(?:team\s*lead|тимлид|тим-лид)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "tech_lead",
    pattern: /(?<![\p{L}\p{N}_])(?:tech\s*lead|техлид|тех-лид|техническ\p{L}*\s+лидер\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "staff",
    pattern: /(?<![\p{L}\p{N}_])(?:principal|staff|ведущ\p{L}*\s+эксперт\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "senior",
    pattern: /(?<![\p{L}\p{N}_])(?:senior|сеньор\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "middle",
    pattern: /(?<![\p{L}\p{N}_])(?:middle|мидл\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "junior",
    pattern: /(?<![\p{L}\p{N}_])(?:junior|младш\p{L}*)(?![\p{L}\p{N}_])/iu
  },
  {
    grade: "intern",
    pattern: /(?<![\p{L}\p{N}_])(?:intern|trainee|стажер\p{L}*)(?![\p{L}\p{N}_])/iu
  }
]

const hit = (pattern: RegExp, text: string): boolean => {
  pattern.lastIndex = 0
  return pattern.test(text)
}

const fromTitle = (text: string): Seniority => {
  for (const rule of TITLE_RULES) {
    if (hit(rule.pattern, text)) return rule.grade
  }
  return "unknown"
}

/** Грейд по описанию, если там явно указан ровно один уровень. */
const fromBody = (text: string): Seniority => {
  const found = new Set<Seniority>()
  for (const rule of BODY_RULES) {
    if (hit(rule.pattern, text)) found.add(rule.grade)
  }
  return found.size === 1 ? found.values().next().value ?? "unknown" : "unknown"
}

/**
 * Грейд вакансии. Заголовок — основной сигнал, описание используется только
 * тогда, когда заголовок не дал ответа. Грейд описателен и никогда не является
 * жёстким фильтром: руководящая роль — это другая беседа, а не повод скрыть
 * вакансию.
 */
export const detectSeniority = (title: string, body = ""): Seniority => {
  const grade = fromTitle(normalizeText(title))
  return grade === "unknown" ? fromBody(normalizeText(body)) : grade
}
