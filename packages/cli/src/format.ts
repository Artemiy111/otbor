import type {
  ApplicationRecord,
  DecisionRecord,
  HarnessJob,
  VacancySummary
} from "@otbor/contract"

export const shortId = (id: string): string => id.slice(0, 8)

/** Fixed-width columns, no dependency: the CLI prints tables, not reports. */
export const table = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>
): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  )
  const line = (cells: ReadonlyArray<string>): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd()
  return [line(headers), ...rows.map(line)].join("\n")
}

export const salary = (vacancy: VacancySummary): string => {
  if (vacancy.salaryFrom === null && vacancy.salaryTo === null) return "-"
  const currency = vacancy.salaryCurrency ?? ""
  const from = vacancy.salaryFrom === null ? "" : `${vacancy.salaryFrom}`
  const to = vacancy.salaryTo === null ? "" : `${vacancy.salaryTo}`
  return `${from}${from !== "" && to !== "" ? "-" : ""}${to} ${currency}`.trim()
}

export const formatVacancy = (vacancy: VacancySummary): Array<string> => [
  shortId(vacancy.id),
  vacancy.title,
  vacancy.employerName ?? "-",
  vacancy.areaName ?? "-",
  salary(vacancy),
  vacancy.archived ? "archived" : ""
]

export const formatDecision = (decision: DecisionRecord): Array<string> => [
  shortId(decision.id),
  decision.verdict,
  `${decision.fit}`,
  `${decision.priority}`,
  decision.vacancyTitle ?? shortId(decision.vacancyId),
  decision.reasons.map((reason) => reason.code).join(",")
]

export const formatApplication = (application: ApplicationRecord): Array<string> => [
  shortId(application.id),
  application.state,
  application.vacancyTitle ?? shortId(application.vacancyId),
  application.employerName ?? "-",
  application.updatedAt.slice(0, 19).replace("T", " ")
]

export const formatJob = (job: HarnessJob): Array<string> => [
  shortId(job.id),
  job.kind,
  job.stage,
  job.status,
  `${job.attempts}/${job.maxAttempts}`,
  job.leaseId === null ? "-" : `${shortId(job.leaseId)}#${job.leaseEpoch}`,
  job.runAt.slice(0, 19).replace("T", " ")
]
