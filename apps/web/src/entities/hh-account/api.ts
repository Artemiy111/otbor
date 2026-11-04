import type { HhAccountId, HhAccountRecord } from "@otbor/contract"
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
    call((client) => client.HhAccountRemove({ id: id as HhAccountId }))
}
