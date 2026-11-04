import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useStorage } from "@vueuse/core"
import { applicationApi, applicationKeys } from "@/entities/application"
import { contactApi, contactKeys } from "@/entities/contact"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { useDefaultAccount } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { describeError } from "@/shared/lib"

/** Everything a vacancy page needs, shared by every layout variant. */
export const useVacancyPage = (id: () => string) => {
  const vacancyQuery = useQuery({
    key: () => vacancyKeys.detail(id()),
    query: () => vacancyApi.get(id())
  })
  const decisionsQuery = useQuery({
    key: decisionKeys.list("all"),
    query: () => decisionApi.list({ limit: 200 })
  })
  const applicationsQuery = useQuery({
    key: applicationKeys.list("all"),
    query: () => applicationApi.list({ limit: 200 })
  })
  const contactsQuery = useQuery({
    key: () => contactKeys.vacancy(id()),
    query: () => contactApi.list({ vacancyId: id(), limit: 50 })
  })
  const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
  const { accounts, defaultAccountId } = useDefaultAccount()

  const data = computed(() => vacancyQuery.data.value)

  // Which account/resume the operator works with. The last resume per account is remembered.
  const accountId = ref("")
  const rememberedResumes = useStorage<Record<string, string>>("otbor.vacancy-resume", {})
  const resumeId = ref("")
  watch(
    [defaultAccountId, accounts],
    () => {
      if (!accounts.value.some((account) => account.id === accountId.value)) {
        accountId.value = defaultAccountId.value ?? accounts.value[0]?.id ?? ""
      }
    },
    { immediate: true }
  )
  const contacts = computed(() => contactsQuery.data.value?.items ?? [])
  const resumes = computed(() => resumesQuery.data.value ?? [])
  watch(
    [accountId, resumes],
    () => {
      const list = resumes.value.filter((resume) => resume.hhAccountId === accountId.value)
      if (list.some((resume) => resume.id === resumeId.value)) return
      const remembered = list.find((resume) => resume.id === rememberedResumes.value[accountId.value])
      resumeId.value = (remembered ?? list.find((resume) => resume.isActive) ?? list[0])?.id ?? ""
    },
    { immediate: true }
  )
  watch(resumeId, (value) => {
    if (value !== "" && accountId.value !== "") {
      rememberedResumes.value = { ...rememberedResumes.value, [accountId.value]: value }
    }
  })
  const selectedResume = computed(() => resumes.value.find((resume) => resume.id === resumeId.value) ?? null)

  const decisions = computed(() =>
    (decisionsQuery.data.value ?? []).filter((decision) => decision.vacancyId === id())
  )
  const applications = computed(() =>
    (applicationsQuery.data.value ?? []).filter((application) => application.vacancyId === id())
  )
  const isLoading = computed(() => vacancyQuery.isLoading.value)
  const errorText = computed(() =>
    vacancyQuery.error.value === null ? null : describeError(vacancyQuery.error.value)
  )

  const refresh = () => {
    void vacancyQuery.refetch()
    void decisionsQuery.refetch()
    void applicationsQuery.refetch()
    void contactsQuery.refetch()
  }
  const refreshApplications = () => void applicationsQuery.refetch()

  const hydrating = ref(false)
  const hydrate = async (force: boolean) => {
    if (hydrating.value) return
    hydrating.value = true
    try {
      const result = await vacancyApi.hydrate(id(), force)
      if (result.hydrated || force) {
        await vacancyQuery.refetch()
        void contactsQuery.refetch()
      }
    } catch {
      // Best effort: the stub stays visible and the operator can retry.
    } finally {
      hydrating.value = false
    }
  }
  watch(
    () => vacancyQuery.data.value,
    (detail) => {
      if (detail !== undefined && detail.descriptionText.trim() === "") void hydrate(false)
    },
    { immediate: true }
  )

  return {
    id,
    vacancyQuery,
    data,
    contacts,
    resumes,
    accounts,
    defaultAccountId,
    accountId,
    resumeId,
    selectedResume,
    decisions,
    applications,
    isLoading,
    errorText,
    hydrating,
    refresh,
    refreshApplications,
    hydrate: () => hydrate(true)
  }
}

export type VacancyPage = ReturnType<typeof useVacancyPage>
