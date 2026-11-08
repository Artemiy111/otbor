import { readInitialState } from "./negotiations.ts"

/**
 * Резюме, которые форма отклика (`/applicant/vacancy_response?vacancyId=...`)
 * предлагает для вакансии. В DOM варианты выбора помечены хэшем резюме
 * (`data-magritte-select-option`), а numeric id (то, что otbor хранит как
 * `resume.external_id`) есть только в состоянии страницы. Отсюда карта id → хэш.
 */
export interface ResponseResume {
  /** Numeric id резюме на hh (`resume.external_id`). */
  readonly id: string
  /** Хэш резюме: ключ варианта в селекте. */
  readonly hash: string
  /** Название, если оно есть в состоянии страницы. */
  readonly title: string | null
}

export interface ResponseResumes {
  readonly resumes: ReadonlyArray<ResponseResume>
  /** `null`, если списка нет на странице: «пусто» и «неизвестно» не одно и то же. */
  readonly usedIds: ReadonlyArray<string> | null
  readonly unusedIds: ReadonlyArray<string> | null
  readonly hiddenIds: ReadonlyArray<string> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const idOf = (value: unknown): string | null =>
  typeof value === "string" && /^\d+$/.test(value)
    ? value
    : typeof value === "number" && Number.isInteger(value) && value >= 0
    ? String(value)
    : null

const titleOf = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null
  const first: unknown = value[0]
  const text = isRecord(first) ? first.string : null
  return typeof text === "string" && text.trim() !== "" ? text.trim() : null
}

const idList = (value: unknown): ReadonlyArray<string> | null =>
  Array.isArray(value) ? value.flatMap((item) => idOf(item) ?? []) : null

/**
 * Карта резюме формы отклика. Читает `resumes` и `resumeVisibility` (id →
 * объект с `hash`), а также списки `usedResumeIds` / `unusedResumeIds` /
 * `hiddenResumeIds` там, где они лежат (первое найденное место). Пустой результат,
 * если состояния на странице нет.
 */
export const parseResponseResumes = (html: string): ResponseResumes => {
  const state = readInitialState(html)
  const found = new Map<string, { hash: string; title: string | null }>()
  const lists: Record<"usedResumeIds" | "unusedResumeIds" | "hiddenResumeIds", ReadonlyArray<string> | null> = {
    usedResumeIds: null,
    unusedResumeIds: null,
    hiddenResumeIds: null
  }

  const take = (map: unknown) => {
    if (!isRecord(map)) return
    for (const [key, entry] of Object.entries(map)) {
      if (!isRecord(entry) || typeof entry.hash !== "string" || entry.hash === "") continue
      const id = idOf(entry.id) ?? idOf(key)
      if (id === null) continue
      const previous = found.get(id)
      found.set(id, { hash: entry.hash, title: titleOf(entry.title) ?? previous?.title ?? null })
    }
  }

  const walk = (node: unknown, depth: number) => {
    if (depth > 12) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (!isRecord(node)) return
    for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
      if (lists[key] === null) lists[key] = idList(node[key])
    }
    take(node.resumes)
    take(node.resumeVisibility)
    for (const [key, value] of Object.entries(node)) {
      if (key !== "resumes" && key !== "resumeVisibility") walk(value, depth + 1)
    }
  }
  if (state !== null) walk(state, 0)

  return {
    resumes: [...found].map(([id, { hash, title }]) => ({ id, hash, title })),
    usedIds: lists.usedResumeIds,
    unusedIds: lists.unusedResumeIds,
    hiddenIds: lists.hiddenResumeIds
  }
}

/** Хэш резюме с этим numeric id на странице отклика, либо `null`. */
export const responseResumeHash = (html: string, resumeId: string): string | null =>
  parseResponseResumes(html).resumes.find((resume) => resume.id === resumeId)?.hash ?? null
