import { useMutation, useQueryCache } from "@pinia/colada"
import type { HarnessJob } from "@otbor/contract"
import { inferenceApi, inferenceKeys, type InferenceEnqueueInput } from "@/entities/inference"
import { queueJobKeys } from "@/entities/queue-job"

/**
 * The only write in the web UI. The cloud enqueues a job; an inference harness
 * owns the actual model call. Queue and inference caches are invalidated so the
 * operator sees the new job on both pages.
 */
export const useInferenceEnqueue = () => {
  const queryCache = useQueryCache()

  return useMutation<{ job: HarnessJob }, InferenceEnqueueInput>({
    mutation: (input) => inferenceApi.enqueue(input),
    async onSuccess() {
      await Promise.all([
        queryCache.invalidateQueries({ key: queueJobKeys.all }),
        queryCache.invalidateQueries({ key: inferenceKeys.all })
      ])
    }
  })
}
