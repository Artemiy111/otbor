import { countWord, type StatusTone } from "@/shared/lib"

/** Что оператору сказать о форме отклика (анкете работодателя) и что с ней можно сделать. */
export interface FormStatus {
  readonly tone: StatusTone
  readonly text: string
  /** `read`: анкету ещё не читали; `refresh`: устарела, лучше перечитать; `null`: делать нечего. */
  readonly action: "read" | "refresh" | null
}

export interface FormStatusInput {
  readonly form: { readonly questions: ReadonlyArray<unknown> } | null
  /** По полям hh: есть ли у вакансии тест; `null`, пока страницу вакансии не читали. */
  readonly hasTest: boolean | null | undefined
  readonly reading: boolean
  readonly stale: boolean
  readonly checkedAt: string | null
  readonly lastError: string | null
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** «только что», «5 мин назад», «3 ч назад», «2 дн. назад». */
export const agoText = (iso: string | null | undefined, now: Date = new Date()): string | null => {
  if (iso === null || iso === undefined || iso === "") return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  const diff = Math.max(0, now.getTime() - time)
  if (diff < MINUTE) return "только что"
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} мин назад`
  if (diff < DAY) return `${Math.round(diff / HOUR)} ч назад`
  return `${Math.round(diff / DAY)} дн. назад`
}

const QUESTION: readonly [string, string, string] = ["вопрос", "вопроса", "вопросов"]

export const formStatus = (input: FormStatusInput, now: Date = new Date()): FormStatus => {
  if (input.reading) return { tone: "info", text: "Читаем анкету на hh…", action: null }
  if (input.form === null) {
    if (input.hasTest === false) return { tone: "neutral", text: "Анкеты нет: достаточно письма", action: null }
    return {
      tone: "neutral",
      text: input.lastError === null ? "Анкету ещё не читали" : "Анкету не удалось прочитать",
      action: "read"
    }
  }
  const count = input.form.questions.length
  const parts = [count === 0 ? "Анкета без вопросов" : countWord(count, QUESTION)]
  const ago = agoText(input.checkedAt, now)
  if (ago !== null) parts.push(`прочитана ${ago}`)
  if (input.lastError !== null) {
    parts.push("обновить не удалось")
    return { tone: "warning", text: parts.join(" · "), action: "refresh" }
  }
  if (input.stale) {
    parts.push("устарела, обновите")
    return { tone: "warning", text: parts.join(" · "), action: "refresh" }
  }
  return { tone: "neutral", text: parts.join(" · "), action: "refresh" }
}

/** Состояние черновика словами: подпись у кнопок «Сохранить» и «Отправить». */
export const draftStateText = (input: {
  readonly dirty: boolean
  readonly savedAt: string | null
  readonly now?: Date
}): { readonly tone: StatusTone; readonly text: string } => {
  if (input.dirty) return { tone: "warning", text: "Есть несохранённые изменения" }
  const ago = agoText(input.savedAt, input.now)
  return ago === null
    ? { tone: "neutral", text: "Черновика ещё нет" }
    : { tone: "neutral", text: `Черновик сохранён ${ago}` }
}
