import type { HhAccountRecord, ResumeRecord, VacancySummary } from "@otbor/contract"

export interface RowAccount {
  readonly accountId: string
  readonly resumeIds: ReadonlyArray<string | null | undefined>
}

/** Props shared by every row variant, so variants can be swapped without touching the page. */
export interface RowProps {
  readonly vacancy: VacancySummary
  readonly responded: ReadonlyArray<RowAccount>
  readonly accounts: ReadonlyArray<HhAccountRecord>
  readonly resumes: ReadonlyArray<ResumeRecord>
  /** Граница «нового»: вакансии, найденные не раньше неё, получают метку «Новая». */
  readonly since: string
  /** Аккаунт области решений: для него считаны вердикт и отклик, от его имени отбраковка. */
  readonly scopeAccountId: string | null
}

/** Фон строки: вакансия из чёрного списка подкрашена, архивная приглушена. */
export const rowClass = (vacancy: VacancySummary): string =>
  vacancy.blacklisted
    ? "bg-danger-muted/40 shadow-[inset_3px_0_0_0] shadow-danger/60"
    : vacancy.archived
      ? "opacity-70"
      : ""

/** Устойчивый оттенок работодателя: одно имя всегда получает один цвет. */
export const employerAvatar = (name: string | null | undefined): { letter: string; hue: number } => {
  const text = (name ?? "").trim()
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return { letter: text === "" ? "?" : [...text][0]!.toUpperCase(), hue: (hash % 12) * 30 + 15 }
}

/** Причина пропуска со строчной буквы, чтобы читаться после двоеточия: «Пропущена: не прошёл фильтр». */
export const lowerFirst = (text: string): string => (text === "" ? text : text[0]!.toLowerCase() + text.slice(1))
