import { computed, ref, watch } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { useStorage } from "@vueuse/core"
import { applicationApi, applicationKeys } from "@/entities/application"
import { contactApi, contactKeys } from "@/entities/contact"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { useDefaultAccount } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { buildRecon, describeError, reconByKey } from "@/shared/lib"
import { decisionsFilter, isLegacyDecisionsResponse, pickDecision } from "./lib"

/** Everything a vacancy page needs, shared by every layout variant. */
export const useVacancyPage = (id: () => string) => {
  const vacancyQuery = useQuery({
    key: () => vacancyKeys.detail(id()),
    query: () => vacancyApi.get(id())
  })
  // Решения этой вакансии: точный запрос по id. Свежее решение на пару аккаунт+резюме
  // выбирает pickDecision, поэтому серверное сворачивание (latestPerVacancy) не нужно.
  const decisionsQuery = useQuery({
    key: () => decisionKeys.vacancy(id()),
    query: async () => {
      const decisions = await decisionApi.list({ vacancyId: id(), limit: 200 })
      if (!isLegacyDecisionsResponse(decisions, id())) return decisions
      // Запасной путь: сервер без `vacancyId` вернул чужие решения. Нужна вакансия:
      // берём её из кэша запроса или дожидаемся загрузки, без второго запроса.
      const detail = vacancyQuery.data.value ?? (await vacancyQuery.refresh()).data
      if (detail === undefined) throw vacancyQuery.error.value ?? new Error("vacancy not loaded")
      return decisionApi.list({
        limit: 100,
        latestPerVacancy: true,
        filter: decisionsFilter(detail.vacancy)
      })
    }
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
  /** Решение для выбранных аккаунта и резюме; `null`, пока такого нет. */
  const decision = computed(() => pickDecision(decisions.value, accountId.value, resumeId.value))
  const decisionState = computed<"loading" | "error" | "ready" | "missing">(() => {
    if (decisionsQuery.error.value !== null && decisionsQuery.error.value !== undefined) return "error"
    if (decisionsQuery.data.value === undefined) return "loading"
    return decisions.value.length === 0 ? "missing" : "ready"
  })
  const queryCache = useQueryCache()
  const evaluating = ref(false)
  /** Пересчитывает решение для выбранных аккаунта и резюме; hh при этом не трогается. */
  const evaluate = async (): Promise<void> => {
    if (evaluating.value || accountId.value === "") return
    evaluating.value = true
    try {
      await vacancyApi.evaluate({ vacancyId: id(), hhAccountId: accountId.value, resumeId: resumeId.value })
      await queryCache.invalidateQueries({ key: decisionKeys.vacancy(id()) })
    } finally {
      evaluating.value = false
    }
  }
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

  const retryDecisions = () => void decisionsQuery.refetch()
  const notFound = computed(() => errorText.value !== null && /NotFound/.test(errorText.value))
  const refreshApplications = () => void applicationsQuery.refetch()

  const hydrating = ref(false)
  /** Итог последней загрузки полной страницы: нужен, чтобы сбой не выглядел пустой вакансией. */
  const hydrateFailed = ref(false)
  const hydrate = async (force: boolean, syncResponses = false) => {
    if (hydrating.value) return
    hydrating.value = true
    hydrateFailed.value = false
    try {
      const result = await vacancyApi.hydrate(id(), force)
      if (result.hydrated || force) {
        await vacancyQuery.refetch()
        void contactsQuery.refetch()
      }
      if (syncResponses && accountId.value !== "") {
        // Responses made by hand on hh.ru only show up after a negotiations sync.
        void applicationApi.syncRun(accountId.value).catch(() => undefined)
      }
    } catch {
      // Заглушка остаётся на экране, а страница честно говорит, что догрузка не удалась.
      hydrateFailed.value = true
    } finally {
      hydrating.value = false
    }
  }
  // Opening the page tops the vacancy up from hh. The server skips the fetch
  // when the stored text is complete, so repeat visits are cheap. Without a
  // response count the page is fetched anyway: only the vacancy page has it.
  let toppedUp: string | null = null
  watch(
    [id, data],
    ([vacancyId, detail]) => {
      if (detail === undefined || detail === null || toppedUp === vacancyId) return
      toppedUp = vacancyId
      void hydrate(detail.responsesTotal == null && !detail.vacancy.archived)
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
    analysis,
    analysisPending: computed(() => analysisQuery.isPending.value),
    recon,
    reconMap,
    decisions,
    decision,
    decisionState,
    evaluating,
    evaluate,
    retryDecisions,
    applications,
    isLoading,
    errorText,
    notFound,
    hydrating,
    hydrateFailed,
    refreshApplications,
    hydrate: () => hydrate(true, true)
  }
}

export type VacancyPage = ReturnType<typeof useVacancyPage>
