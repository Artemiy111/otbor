const EXPERIENCE: Record<string, string> = {
  noExperience: "без опыта",
  between1And3: "опыт 1–3 года",
  between3And6: "опыт 3–6 лет",
  moreThan6: "опыт более 6 лет"
}

const EMPLOYMENT: Record<string, string> = {
  FULL: "полная занятость",
  PART: "частичная занятость",
  PROJECT: "проектная работа",
  FLY_IN_FLY_OUT: "вахта",
  VOLUNTEER: "волонтёрство",
  PROBATION: "стажировка"
}

const WORK_FORMAT: Record<string, string> = {
  REMOTE: "удалённо",
  ON_SITE: "в офисе",
  HYBRID: "гибрид",
  FIELD_WORK: "разъездная работа",
  OFFICE: "в офисе"
}

const lookup = (map: Record<string, string>, value: string): string =>
  map[value] ?? map[value.toUpperCase()] ?? map[value.toLowerCase()] ?? value

export const experienceLabel = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : lookup(EXPERIENCE, value)

export const employmentFormLabel = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : lookup(EMPLOYMENT, value)

export const workFormatText = (value: string): string => {
  const known = lookup(WORK_FORMAT, value)
  return known !== value ? known : value.toLowerCase() === "remote" ? "удалённо" : value
}
