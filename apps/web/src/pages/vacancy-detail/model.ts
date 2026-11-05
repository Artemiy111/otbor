import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useStorage } from "@vueuse/core"
import { applicationApi, applicationKeys } from "@/entities/application"
import { contactApi, contactKeys } from "@/entities/contact"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { useDefaultAccount } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { buildRecon, describeError, reconByKey } from "@/shared/lib"

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
    key: () => applicationKeys.vacancy(id()),
    query: () => applicationApi.list({ vacancyId: id(), limit: 200 })
  })
  const contactsQuery = useQuery({
    key: () => contactKeys.vacancy(id()),
    query: () => contactApi.list({ vacancyId: id(), limit: 50 })
  })
  const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
  const analysisQuery = useQuery({
    key: () => vacancyKeys.analysis(id()),
    query: () => vacancyApi.analysis(id())
  })
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
  const analysis = computed(() => analysisQuery.data.value ?? null)
  /** hh fields, text detectors and the model, lined up per parameter. */
  const recon = computed(() => (data.value ? buildRecon(data.value, analysis.value?.facts ?? null) : []))
  const reconMap = computed(() => reconByKey(recon.value))
  const isLoading = computed(() => vacancyQuery.isLoading.value)
  const errorText = computed(() =>
    vacancyQuery.error.value === null ? null : describeError(vacancyQuery.error.value)
  )

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
      if (force && accountId.value !== "") {
        // Responses made by hand on hh.ru only show up after a negotiations sync.
        void applicationApi.syncRun(accountId.value).catch(() => undefined)
      }
    } catch {
      // Best effort: the stub stays visible and the operator can retry.
    } finally {
      hydrating.value = false
    }
  }
  // Opening the page tops the vacancy up from hh. The server skips the fetch
  // when the stored text is already complete, so this is cheap on repeat visits.
  watch(id, () => void hydrate(false), { immediate: true })

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
    analysis,
    analysisPending: computed(() => analysisQuery.isPending.value),
    recon,
    reconMap,
    decisions,
    applications,
    isLoading,
    errorText,
    hydrating,
    refreshApplications,
    hydrate: () => hydrate(true)
  }
}

export type VacancyPage = ReturnType<typeof useVacancyPage>
