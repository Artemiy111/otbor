/**
 * Отказ сервера в отправке из-за ответов (`AnswersInvalid`): список проблем
 * с кодом и вопросом. Здесь они превращаются в русские фразы и раскладываются
 * по вопросам, чтобы и страница вакансии, и страница отклика показывали
 * одно и то же.
 */

export interface KitProblem {
  readonly code: string
  readonly questionId: string
  readonly message: string
}

const PROBLEM_TEXT: Readonly<Record<string, string>> = {
  form_changed: "Форма на hh изменилась: проверьте письмо и ответы заново.",
  form_unreadable: "Форму не удалось разобрать: откликнитесь на hh.ru вручную.",
  needs_human: "Этот ответ нужно подтвердить самому: поправьте или перепишите его.",
  code_needs_human: "Задание с кодом нужно решить самому.",
  hint_blocked: "Ответ требует вашей проверки: он расходится с данными резюме.",
  letter_required: "Нужно сопроводительное письмо.",
  unknown_question: "Такого вопроса в форме больше нет.",
  unknown_option: "Выбран вариант, которого нет в форме.",
  too_many_options: "Выбрано слишком много вариантов.",
  required_unanswered: "Обязательный вопрос без ответа.",
  hard_hint_overridden: "Ответ расходится с данными вашего резюме: исправьте его.",
  salary_without_number: "В ответе про зарплату нужно число.",
  text_too_long: "Ответ длиннее, чем разрешает hh.",
  banned_style: "Ответ написан в недопустимом стиле: перепишите своими словами."
}

/** Причина отказа по-русски; неизвестный код показывается сообщением сервера. */
export const problemText = (problem: Pick<KitProblem, "code" | "message">): string =>
  PROBLEM_TEXT[problem.code] ?? problem.message

/** Проблемы из ошибки `AnswersInvalid` (или пусто, если ошибка другая). */
export const kitProblems = (error: unknown): ReadonlyArray<KitProblem> => {
  const raw = (error as { problems?: unknown } | null)?.problems
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): Array<KitProblem> => {
    if (typeof item !== "object" || item === null) return []
    const record = item as Record<string, unknown>
    return typeof record.code === "string"
      ? [
          {
            code: record.code,
            questionId: typeof record.questionId === "string" ? record.questionId : "",
            message: typeof record.message === "string" ? record.message : record.code
          }
        ]
      : []
  })
}

/** Проблемы по вопросам; общие (без вопроса, например смена формы) лежат под пустым ключом. */
export const problemsByQuestion = (problems: ReadonlyArray<KitProblem>): Map<string, Array<string>> => {
  const out = new Map<string, Array<string>>()
  for (const problem of problems) {
    const list = out.get(problem.questionId) ?? []
    const text = problemText(problem)
    if (!list.includes(text)) list.push(text)
    out.set(problem.questionId, list)
  }
  return out
}
