import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { pathWithTarget, resolveTarget, searchWithTarget, targetFromSearch, type FilterTarget } from "./target"

/**
 * Выбор «аккаунт hh + резюме» для страниц «Автоотклики» и «Фильтр откликов».
 * Стартует с `?account=&resume=` адреса, сам подставляет аккаунт по умолчанию
 * и пишет итог обратно в адрес (replaceState, без новых записей в истории),
 * поэтому ссылки между страницами сохраняют выбор.
 */
export const useFilterTarget = () => {
  const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
  const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
  const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
  const allResumes = computed<ReadonlyArray<ResumeRecord>>(() => resumesQuery.data.value ?? [])

  const wanted = ref<FilterTarget>(targetFromSearch(window.location.search))

  const target = computed<FilterTarget>(() =>
    resolveTarget(accounts.value, allResumes.value, resumesQuery.data.value !== undefined, wanted.value)
  )
  const accountId = computed(() => target.value.accountId)
  const resumeId = computed(() => target.value.resumeId)
  const resumes = computed(() => allResumes.value.filter((resume) => resume.hhAccountId === accountId.value))
  const account = computed(() => accounts.value.find((item) => item.id === accountId.value) ?? null)
  const resume = computed(() => resumes.value.find((item) => item.id === resumeId.value) ?? null)

  watch(
    target,
    (value) => {
      if (value.accountId === "") return
      const next = searchWithTarget(window.location.search, value)
      if (next === window.location.search) return
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`)
    },
    { immediate: true }
  )

  const select = (next: FilterTarget) => {
    wanted.value = next
  }

  return {
    accounts,
    resumes,
    allResumes,
    account,
    resume,
    target,
    accountId,
    resumeId,
    select,
    /** Путь страницы с тем же выбором. */
    pathWithTarget: (path: string) => pathWithTarget(path, target.value),
    loading: computed(() => accountsQuery.isPending.value),
    error: computed(() => accountsQuery.error.value ?? resumesQuery.error.value ?? null)
  }
}

export type FilterTargetState = ReturnType<typeof useFilterTarget>
