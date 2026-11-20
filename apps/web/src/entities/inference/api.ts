import type { RunnerJob, RunnerJobId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface InferenceEnqueueInput {
  readonly prompt: string
  readonly system?: string
  readonly model?: string
}

export const inferenceApi = {
  get: (id: string): Promise<RunnerJob> =>
    call((client) => client.InferenceGet({ id: id as RunnerJobId })),
  enqueue: (input: InferenceEnqueueInput): Promise<{ readonly job: RunnerJob }> =>
    call((client) => client.InferenceEnqueue(input))
}
