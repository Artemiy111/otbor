import type { AutoApplyRetryResult, CaptchaEpisode, CaptchaModelStat, CaptchaSolveRecord, HhAccountId, HhAccountRecord } from "@otbor/contract"
import { call } from "@/shared/api"

export const hhAccountApi = {
  list: (): Promise<ReadonlyArray<HhAccountRecord>> =>
    call((client) => client.HhAccountsList()),
  upsert: (input: {
    id?: string
    label: string
    isDefault?: boolean
    sessionProfile?: string
    firstName?: string
    lastName?: string
    areaName?: string
    color?: string | null
  }): Promise<HhAccountRecord> =>
    call((client) =>
      client.HhAccountUpsert({
        id: input.id as HhAccountId | undefined,
        label: input.label,
        isDefault: input.isDefault,
        sessionProfile: input.sessionProfile,
        firstName: input.firstName,
        lastName: input.lastName,
        areaName: input.areaName,
        color: input.color
      })
    ),
  remove: (id: string): Promise<{ readonly id: HhAccountId; readonly deleted: boolean }> =>
    call((client) => client.HhAccountRemove({ id: id as HhAccountId })),
  /** Оператор решил капчу: снимает блокировку отправок аккаунта. */
  resumeSubmits: (
    hhAccountId: string
  ): Promise<{ readonly account: HhAccountRecord; readonly released: number }> =>
    call((client) => client.HhAccountSubmitResume({ hhAccountId: hhAccountId as HhAccountId })),
  /** Повторяет заявки аккаунта, остановленные капчей (теперь их пройдёт модель). */
  retryCaptcha: (hhAccountId: string): Promise<AutoApplyRetryResult> =>
    call((client) => client.ApplicationsRetryCaptcha({ hhAccountId: hhAccountId as HhAccountId })),
  /** Журнал распознавания капчи: какая модель, за сколько попыток, решена ли. */
  captchaSolves: (
    limit = 15
  ): Promise<{ readonly solves: ReadonlyArray<CaptchaSolveRecord>; readonly models: ReadonlyArray<CaptchaModelStat> }> =>
    call((client) => client.CaptchaSolvesList({ limit })),
  captchaEpisodes: (limit = 10): Promise<ReadonlyArray<CaptchaEpisode>> =>
    call((client) => client.HhCaptchaEpisodesList({ limit }))
}
