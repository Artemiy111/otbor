import type { GateVerdict, HhAccountRecord, ResumeRecord, VacancySortKey, VacancySummary } from "@otbor/contract"

export const SORT_OPTIONS: ReadonlyArray<{ value: VacancySortKey; label: string; defaultDirection: "asc" | "desc" }> = [
  { value: "date", label: "Дата публикации", defaultDirection: "desc" },
  { value: "salary", label: "Зарплата", defaultDirection: "desc" },
  { value: "title", label: "Название", defaultDirection: "asc" },
  { value: "employer", label: "Компания", defaultDirection: "asc" },
  { value: "rating", label: "Рейтинг компании", defaultDirection: "desc" },
  { value: "area", label: "Город", defaultDirection: "asc" },
  { value: "seniority", label: "Уровень", defaultDirection: "desc" },
  { value: "experience", label: "Опыт", defaultDirection: "asc" },
  { value: "employment", label: "Занятость", defaultDirection: "asc" },
  { value: "firstSeen", label: "Впервые найдена", defaultDirection: "desc" },
  { value: "lastSeen", label: "Последний раз видели", defaultDirection: "desc" },
  { value: "archived", label: "Архивные", defaultDirection: "desc" },
  { value: "blacklisted", label: "Чёрный список", defaultDirection: "desc" },
  { value: "responses", label: "Количество откликов", defaultDirection: "desc" },
  { value: "analysed", label: "ИИ-анализ", defaultDirection: "desc" }
]

export interface RowAccount {
  readonly accountId: string
  readonly resumeIds: ReadonlyArray<string | null | undefined>
}

/** Props shared by every row variant, so variants can be swapped without touching the page. */
export interface RowProps {
  readonly vacancy: VacancySummary
  readonly gate: GateVerdict | null
  readonly responded: ReadonlyArray<RowAccount>
  readonly accounts: ReadonlyArray<HhAccountRecord>
  readonly resumes: ReadonlyArray<ResumeRecord>
}

/** Row background: a blacklisted vacancy is tinted red, an archived one is dimmed. */
export const rowClass = (vacancy: VacancySummary): string =>
  vacancy.blacklisted
    ? "bg-red-500/[0.06] shadow-[inset_3px_0_0_0] shadow-red-500/60"
    : vacancy.archived
      ? "opacity-70"
      : ""

const AVATAR_TONES = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300"
]

/** Stable letter tile for an employer: the same name always gets the same colour. */
export const employerAvatar = (name: string | null | undefined): { letter: string; tone: string } => {
  const text = (name ?? "").trim()
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return { letter: text === "" ? "?" : [...text][0]!.toUpperCase(), tone: AVATAR_TONES[hash % AVATAR_TONES.length]! }
}
