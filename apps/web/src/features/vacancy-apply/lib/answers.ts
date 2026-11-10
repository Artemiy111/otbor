import type { FormQuestion, KitAnswer, StoredHint } from "@otbor/contract"

/**
 * Чистые правила редактора ответов на форму работодателя: что считать
 * ответом, как собрать черновик для сервера, чем он отличается от сохранённого
 * и как показать отказ сервера (`AnswersInvalid`) у нужного вопроса. Без Vue и
 * без сети: одни и те же правила работают на странице вакансии и на странице отклика.
 */

export interface AnswerState {
  optionIds: Array<string>
  text: string
}

export type AnswerMap = Record<string, AnswerState>

type FormKitAnswer = Extract<KitAnswer, { questionId: string }>

export const isChoice = (question: FormQuestion): boolean => question.kind === "single" || question.kind === "multiple"

export const emptyAnswer = (): AnswerState => ({ optionIds: [], text: "" })

export const isAnswered = (question: FormQuestion, answer: AnswerState | undefined): boolean => {
  if (answer === undefined) return false
  return isChoice(question) ? answer.optionIds.length > 0 : answer.text.trim() !== ""
}

export const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|")

/** Новое значение ответа после щелчка по варианту: radio заменяет выбор, checkbox переключает. */
export const toggleOption = (question: FormQuestion, answer: AnswerState, optionId: string): AnswerState => {
  if (question.kind === "single") return { ...answer, optionIds: [optionId] }
  return {
    ...answer,
    optionIds: answer.optionIds.includes(optionId)
      ? answer.optionIds.filter((item) => item !== optionId)
      : [...answer.optionIds, optionId]
  }
}

const isFormAnswer = (item: KitAnswer): item is FormKitAnswer => "questionId" in item

/** Сохранённые в ките ответы по вопросам; старые пары «вопрос-ответ» без id не учитываются. */
export const savedAnswerMap = (list: ReadonlyArray<KitAnswer> | null | undefined): Map<string, FormKitAnswer> =>
  new Map((list ?? []).filter(isFormAnswer).map((item) => [item.questionId, item]))

/**
 * Ответы для экрана: сохранённые в ките, а где их нет - подсказка по резюме.
 * Вопросы без того и другого остаются пустыми.
 */
export const answersFromKit = (
  questions: ReadonlyArray<FormQuestion>,
  saved: ReadonlyArray<KitAnswer> | null | undefined,
  hints: ReadonlyArray<StoredHint>,
  useHints = true
): AnswerMap => {
  const byQuestion = savedAnswerMap(saved)
  const out: AnswerMap = {}
  for (const question of questions) {
    const kitAnswer = byQuestion.get(question.id)
    const hint = useHints ? hints.find((item) => item.questionId === question.id) : undefined
    out[question.id] = {
      optionIds: [...(kitAnswer?.optionIds ?? hint?.optionIds ?? [])],
      text: kitAnswer?.text ?? hint?.text ?? ""
    }
  }
  return out
}

export interface BuildInput {
  readonly questions: ReadonlyArray<FormQuestion>
  readonly answers: Readonly<Record<string, AnswerState>>
  readonly hints: ReadonlyArray<StoredHint>
  /** Ответы ровно так, как написала модель в этой сессии: правка человеком делает их «human». */
  readonly model?: ReadonlyMap<string, AnswerState>
  /** Уже сохранённый кит: неизменённый ответ остаётся как был, со всеми пометками. */
  readonly saved?: ReadonlyArray<KitAnswer> | null
}

const sameValue = (question: FormQuestion, answer: AnswerState, other: { optionIds?: ReadonlyArray<string>; text?: string }) =>
  isChoice(question)
    ? sameSet(answer.optionIds, other.optionIds ?? [])
    : answer.text.trim() === (other.text ?? "").trim()

/** Ответы для `ApplicationsSetKit`: пустые пропускаются, источник определяется по тому, что правил человек. */
export const buildKitAnswers = ({ questions, answers, hints, model, saved }: BuildInput): Array<KitAnswer> => {
  const out: Array<KitAnswer> = []
  const keep = savedAnswerMap(saved)
  for (const question of questions) {
    const answer = answers[question.id]
    if (answer === undefined || !isAnswered(question, answer)) continue
    const choice = isChoice(question)
    const kept = keep.get(question.id)
    if (kept !== undefined && sameValue(question, answer, kept)) {
      out.push(kept)
      continue
    }
    const hint = hints.find((item) => item.questionId === question.id)
    const asHinted = hint !== undefined && sameValue(question, answer, hint)
    const given = model?.get(question.id)
    const asModel = given !== undefined && sameValue(question, answer, given)
    out.push({
      questionId: question.id,
      ...(choice ? { optionIds: [...answer.optionIds] } : { text: answer.text.trim() }),
      source: asHinted ? "hint" : asModel ? "model" : "human",
      hard: asHinted ? hint.hard : false,
      needsHuman: false
    })
  }
  return out
}

/** Строка для сравнения «что на экране» и «что сохранено»: только суть, без пометок источника. */
export const kitSignature = (letter: string | null | undefined, list: ReadonlyArray<KitAnswer>): string =>
  JSON.stringify([
    (letter ?? "").trim(),
    list
      .values()
      .filter(isFormAnswer)
      .map((item) => [item.questionId, [...(item.optionIds ?? [])].sort(), (item.text ?? "").trim()])
      .toArray()
      .sort()
  ])

export interface DirtyInput extends BuildInput {
  readonly letter: string
  readonly savedLetter: string | null | undefined
}

/** Экран отличается от сохранённого кита (письмом или ответами). */
export const isKitDirty = (input: DirtyInput): boolean => {
  // Ответы на вопросы, которых в форме больше нет, экран не показывает и не правит.
  const known = new Set(input.questions.map((question) => question.id))
  const saved = (input.saved ?? []).filter((item) => !isFormAnswer(item) || known.has(item.questionId))
  return kitSignature(input.letter, buildKitAnswers(input)) !== kitSignature(input.savedLetter, saved)
}

export type LetterRule = "required" | "optional" | "absent" | "unknown"

/** Чего не хватает для отправки: письмо, если оно обязательно, и обязательные вопросы. */
export const missingParts = (input: {
  readonly letter: string
  readonly letterRule: LetterRule
  readonly questions: ReadonlyArray<FormQuestion>
  readonly answers: Readonly<Record<string, AnswerState>>
}): Array<string> => {
  const out: Array<string> = []
  if (input.letterRule === "required" && input.letter.trim() === "") out.push("сопроводительное письмо")
  input.questions.forEach((question, index) => {
    if (question.required && !isAnswered(question, input.answers[question.id])) out.push(`вопрос ${index + 1}`)
  })
  return out
}

export { kitProblems, problemText, problemsByQuestion, type KitProblem } from "@/shared/lib/kit-problems"
