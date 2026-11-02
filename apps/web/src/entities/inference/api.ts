import type { HarnessJob, HarnessJobId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface InferenceEnqueueInput {
  readonly prompt: string
  readonly system?: string
  readonly model?: string
}

export const inferenceApi = {
  get: (id: string): Promise<HarnessJob> =>
    call((client) => client.InferenceGet({ id: id as HarnessJobId })),
  enqueue: (input: InferenceEnqueueInput): Promise<{ readonly job: HarnessJob }> =>
    call((client) => client.InferenceEnqueue(input))
}
