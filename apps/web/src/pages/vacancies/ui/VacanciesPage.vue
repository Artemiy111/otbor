<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { useEventListener, useStorage } from "@vueuse/core"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { ALL_ACCOUNTS, DEFAULT_ACCOUNT, hhAccountApi, hhAccountKeys, hhAccountName, useDefaultAccount } from "@/entities/hh-account"
import { decisionKeys } from "@/entities/decision"
import { applicationKeys } from "@/entities/application"
import type { VacancySort, VacancySummary } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { RefreshButton } from "@/features/refresh-button"
import { presetApi, presetKeys } from "@/entities/preset"
import { buildFilter, emptyEditable, toEditable } from "@/features/rule-builder"
import { describeError, locationSearch, replaceSearch } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button, EmptyState } from "@/shared/ui"
import RowFeed from "./listing/RowFeed.vue"
import RowSkeleton from "./listing/RowSkeleton.vue"
import VacanciesFilterPanel from "./VacanciesFilterPanel.vue"
import VacanciesToolbar from "./VacanciesToolbar.vue"
import {
  activeChips,
  emptyCopy,
  filtersToSearch,
  parseFilters,
  quickViewQuery,
  resolveSince,
  sortOption,
  withoutChip,
  type ActiveChip,
  type AnalysedFilter,
  type QuickView,
  type VacancyFilters
} from "../model/filters"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 25
/** Через столько секунд на странице прошлым визитом считается этот: «новое» не залипает навсегда. */
const VISIT_COMMIT_SECONDS = 60

/* ---- фильтры живут в адресе и следуют за ним, пока страница открыта ----------------- */

const filters = computed<VacancyFilters>(() => parseFilters(locationSearch.value))
const setFilters = (patch: Partial<VacancyFilters>) => {
  // Любое изменение выдачи, кроме самой страницы, начинает с первой.
  replaceSearch(filtersToSearch({ ...filters.value, page: 0, ...patch }))
}

/* ---- «Новая»: с прошлого визита ---------------------------------------------------- */

const lastVisit = useStorage<string>("otbor.vacancies.last-visit", "")
/** Граница фиксируется при открытии страницы и не двигается, пока она открыта. */
const since = resolveSince(lastVisit.value)
const commitVisit = () => {
  lastVisit.value = new Date().toISOString()
}
let visitTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  visitTimer = setTimeout(commitVisit, VISIT_COMMIT_SECONDS * 1000)
})
onBeforeUnmount(() => {
  if (visitTimer !== undefined) clearTimeout(visitTimer)
  commitVisit()
})
useEventListener(window, "pagehide", commitVisit)

/* ---- аккаунт области --------------------------------------------------------------- */

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const { accounts, defaultAccountId } = useDefaultAccount()
/** Выбор аккаунта в панели: `default`, `all` или id. */
const accountChoice = computed(() => filters.value.account ?? DEFAULT_ACCOUNT)
/** Что уходит на сервер; для `all` аккаунта нет, сервер берёт основной сам. */
const hhAccountId = computed<string | undefined>(() => {
  const account = filters.value.account
  if (account === ALL_ACCOUNTS) return undefined
  return account ?? defaultAccountId.value
})
const accountName = (id: string) => {
  const account = accounts.value.find((item) => item.id === id)
  return account ? hhAccountName(account) : id.slice(0, 8)
}

/* ---- правила отбора: конструктор, как у пресетов; в адрес не пишутся ------------------ */

const panelOpen = ref(false)
const rules = ref(emptyEditable())
const ruleFilter = computed(() => {
  const built = buildFilter(rules.value)
  if (built.rules === undefined && built.groups === undefined) return undefined
  return built
})
const ruleCount = computed(() => (ruleFilter.value?.rules?.length ?? 0) + (ruleFilter.value?.groups?.length ?? 0))
watch(
  () => JSON.stringify(ruleFilter.value ?? null),
  () => {
    if (filters.value.page > 0) setFilters({ page: 0 })
  }
)

const presetsQuery = useQuery({ key: () => presetKeys.list("all"), query: () => presetApi.list({}) })
const presets = computed(() => presetsQuery.data.value ?? [])

/** Копирует правила пресета в конструктор; сам пресет не меняется. */
const applyPreset = (id: string) => {
  const preset = presets.value.find((item) => item.id === id)
  if (preset === undefined) return
  const next = toEditable(preset.filter)
  rules.value.rules = next.rules
  rules.value.groups = next.groups
  rules.value.location = next.location
  rules.value.keywordIds = next.keywordIds
}
const clearRules = () => {
  const empty = emptyEditable()
  rules.value.rules = empty.rules
  rules.value.groups = empty.groups
  rules.value.location = empty.location
  rules.value.keywordIds = undefined
}

/** Сколько фильтров из панели включено: бейдж кнопки. */
const panelCount = computed(
  () =>
    Number(filters.value.account !== null) +
    Number(filters.value.archived) +
    Number(filters.value.blacklisted) +
    Number(filters.value.analysed !== "all") +
    ruleCount.value
)
const chips = computed(() => activeChips(filters.value, accountName, ruleCount.value))
const removeChip = (key: ActiveChip["key"]) => {
  if (key === "rules") {
    clearRules()
    return
  }
  replaceSearch(filtersToSearch(withoutChip(filters.value, key)))
}
const clearAll = () => {
  clearRules()
  replaceSearch("")
}

/* ---- данные ----------------------------------------------------------------------- */

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

const sort = computed<VacancySort>(() => ({
  key: filters.value.sort,
  direction: sortOption(filters.value.sort).direction
}))

const listQuery = useQuery({
  key: () =>
    vacancyKeys.list({
      analysed: filters.value.analysed,
      respondedAccountId: "",
      search: filters.value.q,
      sort: `${sort.value.key}:${sort.value.direction}`,
      page: String(filters.value.page),
      pageSize: PAGE_SIZE,
      includeArchived: filters.value.archived,
      includeBlacklisted: filters.value.blacklisted,
      hhAccountId: hhAccountId.value ?? ALL_ACCOUNTS,
      filter: JSON.stringify(ruleFilter.value ?? null),
      verdict: filters.value.view,
      applied: filters.value.view,
      seenSince: filters.value.view === "new" ? since : ""
    }),
  // Пока не известен основной аккаунт, запрос не уходит: иначе он дважды считал бы область.
  enabled: () => !accountsQuery.isPending.value,
  query: () =>
    vacancyApi.list({
      limit: PAGE_SIZE,
      offset: filters.value.page * PAGE_SIZE,
      analysed: filters.value.analysed === "all" ? undefined : filters.value.analysed === "yes",
      search: filters.value.q === "" ? undefined : filters.value.q,
      sort: sort.value,
      includeArchived: filters.value.archived,
      includeBlacklisted: filters.value.blacklisted,
      hhAccountId: hhAccountId.value,
      filter: ruleFilter.value,
      // Для счётчика «Новые» граница нужна при любом быстром фильтре; выдачу она не сужает.
      freshSince: since,
      ...quickViewQuery(filters.value.view, since)
    })
})

const vacancies = computed<ReadonlyArray<VacancySummary>>(() => listQuery.data.value?.items ?? [])
const total = computed(() => listQuery.data.value?.total ?? 0)
const counts = computed(() => listQuery.data.value?.counts)
/** Аккаунт, для которого сервер считал решения: явный, основной или null без аккаунтов. */
const scopeAccountId = computed<string | null>(() => listQuery.data.value?.scopeHhAccountId ?? hhAccountId.value ?? null)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isLoading = computed(() => listQuery.isLoading.value)
/** Первая загрузка или смена выдачи без прошлых данных: рисуем строки-скелеты. */
const showSkeleton = computed(() => accountsQuery.isPending.value || listQuery.isPending.value)

const refresh = () => {
  void listQuery.refetch()
}

/** Отбраковка и отклики меняют вердикт строки: список перечитывается, когда их ключи сброшены. */
const queryCache = useQueryCache()
const stopWatching = queryCache.$onAction(({ name, args, after }) => {
  if (name !== "invalidateQueries") return
  const key = (args[0] as { key?: ReadonlyArray<unknown> } | undefined)?.key?.[0]
  if (key === decisionKeys.all[0] || key === applicationKeys.all[0]) after(() => void listQuery.refetch())
})
onBeforeUnmount(() => stopWatching())

const empty = computed(() => emptyCopy(filters.value, ruleCount.value > 0))
const goPage = (index: number) => setFilters({ page: index })
const onView = (view: QuickView) => setFilters({ view })
const onAccount = (value: string) => setFilters({ account: value === DEFAULT_ACCOUNT ? null : value })
const onAnalysed = (value: AnalysedFilter) => setFilters({ analysed: value })
</script>

<template>
  <section>
    <PageHeader
      title="Вакансии"
      description="Найденные вакансии с оценкой по вашему резюме и состоянием отклика: откройте подходящие, остальное пропустите."
    >
      <template #actions>
        <Button variant="outline" as-child>
          <a href="/search">Поиск вакансий</a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <VacanciesToolbar
      :q="filters.q"
      :view="filters.view"
      :sort="filters.sort"
      :total="total"
      :counts="counts"
      :panel-open="panelOpen"
      :panel-count="panelCount"
      :chips="chips"
      :loading="showSkeleton"
      @search="setFilters({ q: $event })"
      @view="onView"
      @sort="setFilters({ sort: $event as VacancyFilters['sort'] })"
      @toggle-panel="panelOpen = !panelOpen"
      @remove-chip="removeChip"
      @clear-all="clearAll"
    />

    <VacanciesFilterPanel
      v-if="panelOpen"
      v-model:rules="rules"
      :account="accountChoice"
      :archived="filters.archived"
      :blacklisted="filters.blacklisted"
      :analysed="filters.analysed"
      :accounts="accounts"
      :default-account-id="defaultAccountId"
      :presets="presets"
      :rule-count="ruleCount"
      @account="onAccount"
      @archived="setFilters({ archived: $event })"
      @blacklisted="setFilters({ blacklisted: $event })"
      @analysed="onAnalysed"
      @preset="applyPreset"
      @clear-rules="clearRules"
    />

    <Alert v-if="listQuery.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансии</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ describeError(listQuery.error.value) }}</p>
        <Button variant="outline" size="sm" :disabled="isLoading" @click="refresh">Повторить</Button>
      </AlertDescription>
    </Alert>

    <div v-if="showSkeleton && !listQuery.error.value" class="divide-y divide-border border-y border-border" aria-busy="true">
      <RowSkeleton v-for="n in 6" :key="n" />
    </div>
    <EmptyState
      v-else-if="vacancies.length === 0 && !listQuery.error.value"
      :title="empty.title"
      :description="empty.description"
    />
    <div v-else-if="vacancies.length > 0" class="divide-y divide-border border-y border-border">
      <RowFeed
        v-for="vacancy in vacancies"
        :key="vacancy.id"
        :vacancy="vacancy"
        :responded="vacancy.responded ?? []"
        :accounts="accounts"
        :resumes="resumes"
        :since="since"
        :scope-account-id="scopeAccountId"
      />
    </div>

    <nav v-if="pageCount > 1" class="flex items-center justify-between py-3 text-sm tabular-nums text-muted-foreground" aria-label="Страницы">
      <span>Страница {{ filters.page + 1 }} из {{ pageCount }}</span>
      <div class="flex gap-1">
        <Button variant="outline" size="sm" :disabled="filters.page === 0" @click="goPage(filters.page - 1)">Назад</Button>
        <Button variant="outline" size="sm" :disabled="filters.page + 1 >= pageCount" @click="goPage(filters.page + 1)">Вперёд</Button>
      </div>
    </nav>
  </section>
</template>
