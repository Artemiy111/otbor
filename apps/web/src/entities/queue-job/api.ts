import type { HarnessJob, JobStage, JobStatus, QueueConcurrency, QueueJob, QueueStats } from "@otbor/contract"
import { call } from "@/shared/api"

export interface QueueJobListInput {
  readonly status?: string
  readonly kind?: "browser" | "inference"
  readonly limit?: number
}

export interface QueueJobSearchInput {
  readonly status?: ReadonlyArray<string>
  readonly stage?: ReadonlyArray<string>
  readonly kind?: "browser" | "inference"
  readonly query?: string
  readonly limit: number
  readonly offset: number
}

export interface QueueJobPage {
  readonly items: ReadonlyArray<QueueJob>
  readonly total: number
}

const text = (source: unknown, key: string): string | null => {
  if (typeof source !== "object" || source === null) return null
  const value = (source as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** Старый сервер: задача без полей, которые новый считает сам; берём их из payload и результата. */
export const legacyJob = (job: HarnessJob): QueueJob => {
  const result = job.result
  const exit = typeof result === "object" && result !== null ? (result as Record<string, unknown>).exit : null
  return {
    ...job,
    hhAccountId: text(job.payload, "hhAccountId") as QueueJob["hhAccountId"],
    accountName: null,
    vacancyId: text(job.payload, "vacancyId") as QueueJob["vacancyId"],
    vacancyTitle: null,
    applicationId: text(job.payload, "applicationId") as QueueJob["applicationId"],
    lastError: text(result, "message") ?? text(result, "error") ?? text(result, "lastError") ?? text(exit, "message")
  }
}

/** Страница из полного списка старого сервера: те же фильтры, но по уже загруженным 200 задачам. */
export const legacyPage = (jobs: ReadonlyArray<HarnessJob>, input: QueueJobSearchInput): QueueJobPage => {
  const query = input.query?.trim().toLowerCase() ?? ""
  const matching = jobs.flatMap((raw) => {
    const job = legacyJob(raw)
    if (input.status !== undefined && input.status.length > 0 && !input.status.includes(job.status)) return []
    if (input.stage !== undefined && input.stage.length > 0 && !input.stage.includes(job.stage)) return []
    if (query !== "" && !(job.lastError ?? "").toLowerCase().includes(query)) return []
    return [job]
  })
  return { items: matching.slice(input.offset, input.offset + input.limit), total: matching.length }
}

/** До этого момента новый вызов не пробуем: сервер его не знает (ещё не перезапущен). */
let legacyUntil = 0
const LEGACY_RETRY_MS = 60_000

const search = async (input: QueueJobSearchInput): Promise<QueueJobPage> => {
  if (Date.now() >= legacyUntil) {
    try {
      return await call((client) =>
        client.QueueJobsSearch({
          // Значения приходят из адреса и уже сверены со списком известных (`parseQueueFilter`).
          status: input.status as ReadonlyArray<JobStatus> | undefined,
          stage: input.stage as ReadonlyArray<JobStage> | undefined,
          kind: input.kind,
          query: input.query === undefined || input.query.trim() === "" ? undefined : input.query.trim(),
          limit: input.limit,
          offset: input.offset
        })
      )
    } catch (cause) {
      const jobs = await call((client) => client.QueueJobsList({ kind: input.kind, limit: 200 })).catch(() => null)
      // Старый список тоже не ответил: настоящая ошибка, а не отсутствие вызова.
      if (jobs === null) throw cause
      legacyUntil = Date.now() + LEGACY_RETRY_MS
      return legacyPage(jobs, input)
    }
  }
  const jobs = await call((client) => client.QueueJobsList({ kind: input.kind, limit: 200 }))
  return legacyPage(jobs, input)
}

export const queueJobApi = {
  stats: (kind?: "browser" | "inference"): Promise<QueueStats> =>
    call((client) => client.QueueStatsGet({ kind })),
  concurrency: (): Promise<QueueConcurrency> => call((client) => client.QueueConcurrencyGet({})),
  /** Для CLI и MCP; страница очереди читает `search`. */
  list: (input: QueueJobListInput): Promise<ReadonlyArray<HarnessJob>> =>
    call((client) => client.QueueJobsList(input)),
  search
}
