import { RESUME_FAQ_TOPICS, SALARY_CURRENCIES } from "@otbor/contract"
import type { ResumeEnrichment, SalaryCurrency } from "@otbor/contract"

/** Раздел, который сохраняется отдельно от остальных. */
export type Section = "notes" | "salary" | "faq"
export const SECTIONS: ReadonlyArray<Section> = ["notes", "salary", "faq"]

export type Employment = "auto" | "employed" | "unemployed"

export interface SalaryDraft {
  min: string | number
  expectation: string | number
}
export interface CustomFaq {
  id: number
  question: string
  answer: string
}
/** Место работы из резюме: точный ключ и поиск по прежним, более коротким ключам. */
export interface ExperienceItem {
  readonly key: string
  readonly matches: (stored: string) => boolean
}

export interface EnrichmentDraft {
  comment: string
  employment: Employment
  salaries: Record<SalaryCurrency, SalaryDraft>
  faqAnswers: Record<string, string>
  customFaq: CustomFaq[]
  jobNotes: Record<string, string>
}

let customFaqId = 0
export const newCustomFaqId = (): number => ++customFaqId

const topicKeys: ReadonlyArray<string> = RESUME_FAQ_TOPICS.map((topic) => topic.key)

const amountText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value))

/** `type="number"` inputs make v-model hand over a number, not a string. */
export const toAmount = (value: string | number | null | undefined): number | null => {
  const text = String(value ?? "").replace(/\s+/g, "")
  const n = Number(text)
  return text !== "" && Number.isInteger(n) && n > 0 ? n : null
}

export const emptySalaries = (): Record<SalaryCurrency, SalaryDraft> =>
  Object.fromEntries(SALARY_CURRENCIES.map((currency) => [currency, { min: "", expectation: "" }])) as Record<
    SalaryCurrency,
    SalaryDraft
  >

export const emptyDraft = (): EnrichmentDraft => ({
  comment: "",
  employment: "auto",
  salaries: emptySalaries(),
  faqAnswers: {},
  customFaq: [],
  jobNotes: {}
})

/** Заметка, сохранённая для места работы: по точному ключу, иначе по прежнему короткому. */
const savedNote = (data: ResumeEnrichment | null | undefined, item: ExperienceItem): string => {
  const entries = data?.experience ?? []
  const old = entries.find((entry) => entry.key === item.key) ?? entries.find((entry) => item.matches(entry.key))
  return old?.comment ?? ""
}

/** Черновик, равный тому, что сохранено на сервере. */
export const draftFromEnrichment = (
  data: ResumeEnrichment | null | undefined,
  items: ReadonlyArray<ExperienceItem>
): EnrichmentDraft => {
  if (!data) return emptyDraft()
  const salaries = emptySalaries()
  for (const slot of data.salaries ?? []) {
    salaries[slot.currency] = { min: amountText(slot.min), expectation: amountText(slot.expectation) }
  }
  const faq = data.faq ?? []
  return {
    comment: data.comment ?? "",
    employment: data.currentlyEmployed === true ? "employed" : data.currentlyEmployed === false ? "unemployed" : "auto",
    salaries,
    faqAnswers: Object.fromEntries(faq.filter((entry) => topicKeys.includes(entry.key)).map((entry) => [entry.key, entry.answer])),
    customFaq: faq
      .filter((entry) => !topicKeys.includes(entry.key))
      .map((entry) => ({ id: newCustomFaqId(), question: entry.question ?? "", answer: entry.answer })),
    jobNotes: Object.fromEntries(
      items.flatMap((item) => {
        const note = savedNote(data, item)
        return note === "" ? [] : [[item.key, note] as const]
      })
    )
  }
}

/** Ответы на вопросы, которые попадут в сохранение: без пустых. */
const faqEntries = (draft: EnrichmentDraft) =>
  [
    ...RESUME_FAQ_TOPICS.map((topic) => ({ key: topic.key, question: undefined as string | undefined, answer: draft.faqAnswers[topic.key] ?? "" })),
    ...draft.customFaq.map((entry) => ({ key: `custom:${entry.id}`, question: entry.question.trim(), answer: entry.answer }))
  ].filter((entry) => entry.answer.trim() !== "")

const salaryEntries = (draft: EnrichmentDraft) =>
  SALARY_CURRENCIES.flatMap((currency) => {
    const slot = draft.salaries[currency]
    const min = toAmount(slot.min)
    const expectation = toAmount(slot.expectation)
    return min === null && expectation === null ? [] : [{ currency, min, expectation }]
  })

/** Содержимое раздела в сравнимом виде: пустые поля и номера строк не считаются правкой. */
const snapshot = (section: Section, draft: EnrichmentDraft, items: ReadonlyArray<ExperienceItem>): string => {
  switch (section) {
    case "notes":
      return JSON.stringify([
        draft.comment.trim(),
        draft.employment,
        items.map((item) => (draft.jobNotes[item.key] ?? "").trim())
      ])
    case "salary":
      return JSON.stringify(salaryEntries(draft))
    case "faq":
      return JSON.stringify(faqEntries(draft).map((entry) => [entry.key.startsWith("custom:") ? "custom" : entry.key, entry.question ?? "", entry.answer.trim()]))
  }
}

export const isSectionDirty = (
  section: Section,
  draft: EnrichmentDraft,
  saved: EnrichmentDraft,
  items: ReadonlyArray<ExperienceItem>
): boolean => snapshot(section, draft, items) !== snapshot(section, saved, items)

/** Возвращает полям раздела сохранённые значения; остальные разделы не трогает. */
export const revertSection = (section: Section, draft: EnrichmentDraft, saved: EnrichmentDraft): EnrichmentDraft => {
  switch (section) {
    case "notes":
      return { ...draft, comment: saved.comment, employment: saved.employment, jobNotes: { ...saved.jobNotes } }
    case "salary":
      return { ...draft, salaries: structuredClone(saved.salaries) }
    case "faq":
      return { ...draft, faqAnswers: { ...saved.faqAnswers }, customFaq: saved.customFaq.map((entry) => ({ ...entry })) }
  }
}

export interface SavePayload {
  comment?: string
  currentlyEmployed?: boolean | null
  salaries?: Array<{ currency: SalaryCurrency; min: number | null; expectation: number | null }>
  faq?: Array<{ key: string; question?: string | null; answer: string }>
  experience?: Array<{ key: string; employmentType?: string | null; comment?: string | null; leaveReason?: string | null }>
}

/**
 * Что отправить при сохранении одного раздела. Сервер принимает всю карточку
 * целиком, поэтому остальные разделы берутся такими, какими они сохранены,
 * а не из чернового текста: сохранение одного раздела чужих правок не записывает.
 */
export const buildSavePayload = (
  section: Section,
  draft: EnrichmentDraft,
  data: ResumeEnrichment | null | undefined,
  items: ReadonlyArray<ExperienceItem>
): SavePayload => {
  const savedExperience = data?.experience ?? []
  const base: SavePayload = {
    comment: data?.comment ?? "",
    currentlyEmployed: data?.currentlyEmployed ?? null,
    salaries: (data?.salaries ?? []).map((slot) => ({ currency: slot.currency, min: slot.min ?? null, expectation: slot.expectation ?? null })),
    faq: (data?.faq ?? []).map((entry) => ({ key: entry.key, question: entry.question ?? null, answer: entry.answer })),
    experience: savedExperience.map((entry) => ({
      key: entry.key,
      employmentType: entry.employmentType ?? null,
      comment: entry.comment ?? null,
      leaveReason: entry.leaveReason ?? null
    }))
  }
  switch (section) {
    case "salary":
      return { ...base, salaries: salaryEntries(draft) }
    case "faq":
      return { ...base, faq: faqEntries(draft).map((entry) => ({ key: entry.key, question: entry.question, answer: entry.answer })) }
    case "notes": {
      const shownKeys = new Set(items.map((item) => item.key))
      const experience = [
        // Notes for jobs that are no longer in the imported resume stay as they were.
        ...base.experience!.filter((entry) => !shownKeys.has(entry.key) && !items.some((item) => item.matches(entry.key))),
        ...items.flatMap((item) => {
          const old = base.experience!.find((entry) => entry.key === item.key || item.matches(entry.key))
          const note = (draft.jobNotes[item.key] ?? "").trim()
          if (note === "" && !old?.employmentType && !old?.leaveReason) return []
          return [
            {
              key: item.key,
              employmentType: old?.employmentType ?? null,
              comment: note === "" ? null : note,
              leaveReason: old?.leaveReason ?? null
            }
          ]
        })
      ]
      return {
        ...base,
        comment: draft.comment,
        currentlyEmployed: draft.employment === "auto" ? null : draft.employment === "employed",
        experience
      }
    }
  }
}
