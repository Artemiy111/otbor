import type {
  AgentCatalog,
  HarnessJob,
  HarnessJobId,
  NegotiationsSyncStatus,
  ApplicationDetail,
  ApplicationId,
  ApplicationRecord,
  DecisionId,
  DraftLetterLength,
  HhAccountId,
  KitAnswer,
  KitRecord,
  LetterAttachStatus,
  LetterDraft,
  ResumeId,
  VacancyFormState,
  VacancyId
} from "@otbor/contract"
import { call } from "@/shared/api"
import { filterStates, matchesFilter, type ApplicationFilter } from "./filter"

export interface ApplicationListInput {
  readonly state?: string
  readonly hhAccountId?: string
  readonly vacancyId?: string
  readonly limit?: number
}

export interface ApplicationCreateFromDecisionInput {
  readonly decisionId: string
  readonly hhAccountId: string
  readonly resumeId?: string
}

export interface ApplicationSetKitInput {
  readonly applicationId: string
  readonly formHash: string
  readonly letter: string | null
  readonly answers: ReadonlyArray<KitAnswer>
}

/** Страница откликов: строки, настоящий итог и счётчики по состояниям. */
export interface ApplicationPage {
  readonly items: ReadonlyArray<ApplicationRecord>
  readonly total: number
  readonly byState: Readonly<Record<string, number>>
  /**
   * Сервер ещё не знает `ApplicationsSearch`: страница собрана из последних
   * 200 откликов на клиенте, итог и счётчики могут быть занижены.
   */
  readonly capped: boolean
}

export interface ApplicationSearchInput {
  readonly filter: ApplicationFilter
  /** Уже выбранный аккаунт (id) или `undefined` - все. */
  readonly hhAccountId?: string
  readonly limit: number
  readonly offset: number
}

/** Сколько откликов отдаёт `ApplicationsList`; запасной путь не видит дальше. */
const LIST_CAP = 200

/** Пока сервер не обновлён, `ApplicationsSearch` не существует: после первой неудачи не пробуем снова. */
let searchSupported = true

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const applicationApi = {
  createManual: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
  }): Promise<{ readonly application: ApplicationRecord; readonly created: boolean }> =>
    call((client) =>
      client.ApplicationsCreateManual({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId
      })
    ),
  /** The response form of a vacancy as last read; never opens hh. */
  formGet: (vacancyId: string): Promise<VacancyFormState> =>
    call((client) => client.VacancyFormGet({ vacancyId: vacancyId as VacancyId })),
  /** Queues a form read when the stored form is stale, or always with `force`. */
  formRefresh: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly force?: boolean
  }): Promise<VacancyFormState> =>
    call((client) =>
      client.VacancyFormRefresh({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        force: input.force
      })
    ),
  /** The exact prompt a generation would send. Read-only. */
  draftPrompt: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
    readonly length?: DraftLetterLength
  }): Promise<{ readonly system: string; readonly user: string; readonly promptVersion: string }> =>
    call((client) =>
      client.DraftPromptPreview({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId,
        length: input.length
      })
    ),
  agentCatalog: (): Promise<AgentCatalog> => call((client) => client.AgentCatalogGet({})),
  draftGenerate: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
    readonly length?: DraftLetterLength
    readonly harness: string
    readonly model?: string
    readonly effort?: string
  }): Promise<{ readonly job: HarnessJob }> =>
    call((client) =>
      client.DraftGenerate({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId,
        length: input.length,
        harness: input.harness,
        model: input.model,
        effort: input.effort
      })
    ),
  inferenceGet: (id: string): Promise<HarnessJob> =>
    call((client) => client.InferenceGet({ id: id as HarnessJobId })),
  setKit: (input: ApplicationSetKitInput): Promise<KitRecord> =>
    call((client) =>
      client.ApplicationsSetKit({
        applicationId: input.applicationId as ApplicationId,
        formHash: input.formHash,
        letter: input.letter,
        answers: input.answers
      })
    ),
  /**
   * Страница откликов по фильтру с настоящим итогом. Если сервер не знает
   * `ApplicationsSearch` (ещё не перезапущен), берёт последние 200 через
   * `ApplicationsList` и фильтрует на клиенте; тогда `capped` истинно.
   */
  search: async (input: ApplicationSearchInput): Promise<ApplicationPage> => {
    const { filter } = input
    if (searchSupported) {
      try {
        const page = await call((client) =>
          client.ApplicationsSearch({
            states: [...filterStates(filter)],
            hhAccountId: input.hhAccountId as HhAccountId | undefined,
            blockedReason: filter.reason ?? undefined,
            mode: filter.mode ?? undefined,
            search: filter.q === "" ? undefined : filter.q,
            limit: input.limit,
            offset: input.offset
          })
        )
        return { ...page, capped: false }
      } catch (error) {
        const rows = await applicationApi.list({ limit: LIST_CAP, hhAccountId: input.hhAccountId }).catch(() => null)
        if (rows === null) throw error
        searchSupported = false
      }
    }
    const rows = await applicationApi.list({ limit: LIST_CAP, hhAccountId: input.hhAccountId })
    const matching = rows.filter((row) => matchesFilter(row, { ...filter, account: null }))
    const byState: Record<string, number> = {}
    for (const row of rows) byState[row.state] = (byState[row.state] ?? 0) + 1
    return {
      items: matching.slice(input.offset, input.offset + input.limit),
      total: matching.length,
      byState,
      capped: rows.length >= LIST_CAP
    }
  },
  /**
   * Читает форму вакансии заново и ждёт результата: перед отправкой форма
   * должна быть свежей. Возвращает хеш формы, как она сейчас на hh, или `null`,
   * если у вакансии нет формы.
   */
  readFormNow: async (vacancyId: string, hhAccountId: string): Promise<string | null> => {
    const before = (await applicationApi.formGet(vacancyId)).checkedAt ?? null
    await applicationApi.formRefresh({ vacancyId, hhAccountId, force: true })
    for (let attempt = 0; attempt < 40; attempt++) {
      await pause(3000)
      const current = await applicationApi.formGet(vacancyId)
      if (!current.reading) {
        if (current.checkedAt !== null && current.checkedAt !== before) return current.form?.formHash ?? null
        throw new Error(current.lastError ?? "Не удалось прочитать форму отклика на hh.")
      }
    }
    throw new Error("hh слишком долго не отвечает: форма не обновилась.")
  },
  retry: (id: string): Promise<ApplicationRecord> =>
    call((client) => client.ApplicationsRetry({ id: id as ApplicationId })),
  approve: (id: string): Promise<ApplicationRecord> =>
    call((client) => client.ApplicationsApprove({ id: id as ApplicationId })),
  skip: (id: string, reason?: string): Promise<ApplicationRecord> =>
    call((client) => client.ApplicationsSkip({ id: id as ApplicationId, reason })),
  /** Adds a cover letter to the response hh already holds. Queues one job; sent at most once. */
  letterAttach: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string | null
    readonly letter: string
  }): Promise<LetterAttachStatus> =>
    call((client) =>
      client.VacancyLetterAttach({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: (input.resumeId || null) as ResumeId | null,
        letter: input.letter
      })
    ),
  letterDraftGet: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId: string | null
  }): Promise<LetterDraft> =>
    call((client) =>
      client.VacancyLetterDraftGet({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: (input.resumeId || null) as ResumeId | null
      })
    ),
  letterDraftSave: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId: string | null
    readonly letter: string
  }): Promise<LetterDraft> =>
    call((client) =>
      client.VacancyLetterDraftSave({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: (input.resumeId || null) as ResumeId | null,
        letter: input.letter
      })
    ),
  letterAttachStatus: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string | null
  }): Promise<LetterAttachStatus> =>
    call((client) =>
      client.VacancyLetterAttachStatus({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: (input.resumeId || null) as ResumeId | null
      })
    ),
  syncRun: (hhAccountId: string): Promise<NegotiationsSyncStatus> =>
    call((client) => client.NegotiationsSyncRun({ hhAccountId: hhAccountId as HhAccountId })),
  syncStatus: (hhAccountId: string): Promise<NegotiationsSyncStatus> =>
    call((client) => client.NegotiationsSyncStatus({ hhAccountId: hhAccountId as HhAccountId })),
  list: (input: ApplicationListInput): Promise<ReadonlyArray<ApplicationRecord>> =>
    call((client) => client.ApplicationsList({
        ...input,
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        vacancyId: input.vacancyId as VacancyId | undefined
      })),
  get: (id: string): Promise<ApplicationDetail> =>
    call((client) => client.ApplicationsGet({ id: id as ApplicationId })),
  createFromDecision: (input: ApplicationCreateFromDecisionInput): Promise<ApplicationRecord> =>
    call((client) =>
      client.ApplicationsCreateFromDecision({
        decisionId: input.decisionId as DecisionId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId
      })
    )
}
