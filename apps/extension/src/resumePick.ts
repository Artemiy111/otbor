import type { ResponseResume } from "@otbor/hh"

/**
 * Чистые помощники выбора резюме в форме отклика. Резюме опознаётся по id hh
 * (`resume.external_id`), а не по названию: названия повторяются. В DOM вариант
 * селекта помечен хэшем, а id → хэш лежит в состоянии страницы
 * (`parseResponseResumes`).
 */

/** Хэш резюме hh это hex; всё остальное в селектор не подставляем. */
export const isResumeHash = (hash: string): boolean => /^[0-9a-f]{16,64}$/i.test(hash)

/** Numeric id резюме по хэшу выбранного варианта, либо `null`. */
export const resumeIdOfHash = (resumes: ReadonlyArray<ResponseResume>, hash: string | null): string | null =>
  hash === null ? null : (resumes.find((resume) => resume.hash === hash)?.id ?? null)

/** Хэш варианта селекта для numeric id резюме, либо `null`. */
export const resumeHashOfId = (resumes: ReadonlyArray<ResponseResume>, id: string | null): string | null =>
  id === null ? null : (resumes.find((resume) => resume.id === id)?.hash ?? null)

export interface DraftWithResume {
  readonly resumeExternalId: string | null
}

/**
 * Черновик для формы на экране: черновик резюме, выбранного в форме (по id hh),
 * иначе единственный из имеющихся. `matched` ложно, когда черновик взят «за
 * единственный», а выбранное в форме резюме известно и другое.
 */
export const chooseDraft = <D extends DraftWithResume>(
  candidates: ReadonlyArray<D>,
  selectedId: string | null
): { readonly draft: D; readonly matched: boolean } | null => {
  if (selectedId !== null) {
    const same = candidates.find((draft) => draft.resumeExternalId === selectedId)
    if (same !== undefined) return { draft: same, matched: true }
  }
  if (candidates.length === 1) return { draft: candidates[0]!, matched: selectedId === null }
  return null
}

/**
 * Резюме, которое нужно выбрать в форме: черновик ровно одного резюме с
 * известным id, когда выбранного в форме среди черновиков нет. `null`: ничего
 * менять не нужно или нельзя (выбранное неизвестно, у выбранного есть черновик,
 * подходящих нет или их несколько).
 */
export const resumeToSelect = <D extends DraftWithResume>(
  usable: ReadonlyArray<D>,
  selectedId: string | null
): D | null => {
  if (selectedId === null) return null
  if (usable.some((draft) => draft.resumeExternalId === selectedId)) return null
  const identified = usable.filter((draft) => draft.resumeExternalId !== null)
  return identified.length === 1 ? identified[0]! : null
}
