import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { applicationApi, applicationKeys } from "@/entities/application"

/** The cover letter job of a vacancy for an account; polled while one is in flight. */
export const useLetterStatus = (
  vacancyId: () => string,
  accountId: () => string,
  resumeId: () => string | null = () => null
) => {
  const query = useQuery({
    key: () => applicationKeys.letterAttach(vacancyId(), accountId(), resumeId() ?? ""),
    query: () =>
      applicationApi.letterAttachStatus({ vacancyId: vacancyId(), hhAccountId: accountId(), resumeId: resumeId() }),
    enabled: () => accountId() !== ""
  })
  useIntervalFn(() => void query.refetch(), 3000, { immediate: true, immediateCallback: false })
  const status = computed(() => query.data.value ?? null)
  return { query, status, sent: computed(() => status.value?.status === "sent") }
}
