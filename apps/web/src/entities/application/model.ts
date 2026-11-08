export const applicationKeys = {
  all: ["applications"] as const,
  list: (state: string, account = "all") => ["applications", "list", state, account] as const,
  vacancy: (vacancyId: string) => ["applications", "vacancy", vacancyId] as const,
  detail: (id: string) => ["applications", "detail", id] as const,
  agentCatalog: ["agent-catalog"] as const,
  inference: (id: string) => ["inference", id] as const,
  letterAttach: (vacancyId: string, accountId: string, resumeId = "") =>
    ["applications", "letter-attach", vacancyId, accountId, resumeId] as const,
  letterDraft: (vacancyId: string, accountId: string, resumeId: string) =>
    ["applications", "letter-draft", vacancyId, accountId, resumeId] as const,
  vacancyForm: (vacancyId: string) => ["applications", "vacancy-form", vacancyId] as const
}

/** Applications that count as "this account responded to the vacancy". */
const RESPONDED_STATES = new Set(["submitted", "submitting", "queued", "preparing"])

export interface RespondedAccount {
  readonly accountId: string
  /** Every resume the account responded with (several resumes may apply to one vacancy). */
  readonly resumeIds: ReadonlyArray<string | null>
}

/** Per vacancy: the accounts that responded, each with the resumes it used. */
export const respondedByVacancy = (
  applications: ReadonlyArray<{
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string | null
    readonly state: string
  }>
): Map<string, ReadonlyArray<RespondedAccount>> => {
  const byVacancy = new Map<string, Array<{ accountId: string; resumeIds: Array<string | null> }>>()
  for (const application of applications) {
    if (!RESPONDED_STATES.has(application.state)) continue
    const list = byVacancy.get(application.vacancyId) ?? []
    let entry = list.find((item) => item.accountId === application.hhAccountId)
    if (entry === undefined) {
      entry = { accountId: application.hhAccountId, resumeIds: [] }
      list.push(entry)
    }
    const resumeId = application.resumeId ?? null
    if (!entry.resumeIds.includes(resumeId)) entry.resumeIds.push(resumeId)
    byVacancy.set(application.vacancyId, list)
  }
  return byVacancy
}
