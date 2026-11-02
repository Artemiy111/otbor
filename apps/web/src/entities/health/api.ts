import type { Health } from "@otbor/contract"
import { call } from "@/shared/api"

export const healthApi = {
  get: (): Promise<Health> => call((client) => client.SystemHealth())
}
