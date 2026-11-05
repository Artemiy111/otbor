import { computed } from "vue"
import type { ApplicationRecord, HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { applicationStatus, formatDate } from "@/shared/lib"

export interface ResponseSummaryProps {
  readonly vacancyId: string
  readonly applications: ReadonlyArray<ApplicationRecord>
  readonly accounts: ReadonlyArray<HhAccountRecord>
  readonly resumes: ReadonlyArray<ResumeRecord>
  readonly accountId: string
  readonly resumeId: string
}

export interface ResponseRow {
  readonly key: string
  readonly accountId: string
  readonly resumeId: string | null
  readonly resumeTitle: string
  readonly application: ApplicationRecord | null
  readonly label: string
  readonly tone: "success" | "danger" | "neutral" | "warning" | "info"
  readonly fromHh: boolean
  readonly when: string | null
  readonly selected: boolean
}

/**
 * One row per resume that has an application, newest first, plus a row for
 * the selected resume when it has none. Every variant renders these same rows.
 */
export const useResponseRows = (props: ResponseSummaryProps) => {
  const rows = computed<ReadonlyArray<ResponseRow>>(() => {
    const newest = new Map<string, ApplicationRecord>()
    for (const application of props.applications) {
      const key = `${application.hhAccountId}|${application.resumeId ?? ""}`
      const current = newest.get(key)
      if (current === undefined || application.updatedAt > current.updatedAt) newest.set(key, application)
    }
    const selectedKey = `${props.accountId}|${props.resumeId}`
    const list: Array<ResponseRow> = [...newest.entries()]
      .toSorted(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
      .map(([key, application]) => {
        const status = applicationStatus(application)
        return {
          key,
          accountId: application.hhAccountId,
          resumeId: application.resumeId ?? null,
          resumeTitle:
            props.resumes.find((resume) => resume.id === application.resumeId)?.title ?? "резюме не определено",
          application,
          label: status.label,
          tone: status.tone as ResponseRow["tone"],
          fromHh: status.fromHh,
          when: formatDate(application.hhRespondedAt ?? application.updatedAt),
          selected: key === selectedKey
        }
      })
    if (!list.some((row) => row.selected) && props.accountId !== "") {
      list.unshift({
        key: selectedKey,
        accountId: props.accountId,
        resumeId: props.resumeId === "" ? null : props.resumeId,
        resumeTitle: props.resumes.find((resume) => resume.id === props.resumeId)?.title ?? "резюме не выбрано",
        application: null,
        label: "не откликались",
        tone: "neutral",
        fromHh: false,
        when: null,
        selected: true
      })
    }
    return list
  })
  const selected = computed(() => rows.value.find((row) => row.selected) ?? null)
  const others = computed(() => rows.value.filter((row) => !row.selected))
  return { rows, selected, others }
}

export const toneClass = (row: Pick<ResponseRow, "tone" | "application">): string => {
  if (row.application === null) return "border-dashed border-border"
  if (row.tone === "danger") return "border-red-500/50 bg-red-500/10"
  if (row.tone === "success") return "border-emerald-500/50 bg-emerald-500/10"
  return "border-sky-500/40 bg-sky-500/5"
}
