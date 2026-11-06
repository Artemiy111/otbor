<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useDebounceFn } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { ALL_ACCOUNTS, useAccountFilter } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import type { VacancySort, VacancySortKey, VacancySummary } from "@otbor/contract"
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CircleAlert, ListFilter } from "@lucide/vue"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { blacklistVisibilityOptions } from "@/features/blacklist-filter"
import { vacancyAnalysedOptions, vacancyArchiveOptions } from "@/features/vacancy-filter"
import { RefreshButton } from "@/features/refresh-button"
import { presetApi, presetKeys } from "@/entities/preset"
import { RuleBuilder, buildFilter, emptyEditable, toEditable } from "@/features/rule-builder"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton
} from "@/shared/ui"
import RowFeed from "./listing/RowFeed.vue"
import { SORT_OPTIONS } from "./listing/model"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 25

const analysed = ref("all")
const archived = ref("active")
const includeBlacklisted = ref(false)
/** Search, sort and page are sent to the server: they apply to every vacancy, not to a loaded slice. */
const search = ref("")
const sortKey = ref<VacancySortKey>("date")
const sortDirection = ref<"asc" | "desc">("desc")
const pageIndex = ref(0)

const changeSortKey = (value: unknown) => {
  const option = SORT_OPTIONS.find((item) => item.value === value)
  if (option === undefined) return
  sortKey.value = option.value
  sortDirection.value = option.defaultDirection
}
const toggleDirection = () => {
  sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc"
}

const applySearch = useDebounceFn((value: string) => {
  search.value = value
}, 300)

const serverSort = computed<VacancySort>(() => ({ key: sortKey.value, direction: sortDirection.value }))

/** Ad-hoc rules: the same constructor as presets, applied on the server to the whole corpus. */
const rulesOpen = ref(false)
const rules = ref(emptyEditable())
const ruleFilter = computed(() => {
  const built = buildFilter(rules.value)
  if (built.rules === undefined && built.groups === undefined) return undefined
  // The header toggles own archive and blacklist visibility.
  return {
    ...built,
    ...(includeBlacklisted.value ? { includeBlacklisted: true } : {})
  }
})

const presetsQuery = useQuery({ key: () => presetKeys.list("all"), query: () => presetApi.list({}) })
const presets = computed(() => presetsQuery.data.value ?? [])

/** Copies the preset's rules into the builder; the preset itself is never changed. */
const applyPreset = (id: unknown) => {
  const preset = presets.value.find((item) => item.id === id)
  if (preset === undefined) return
  const next = toEditable(preset.filter)
  rules.value.rules = next.rules
  rules.value.groups = next.groups
  rules.value.location = next.location
  rules.value.keywordIds = next.keywordIds
  includeBlacklisted.value = next.includeBlacklisted
  rulesOpen.value = true
}

const clearRules = () => {
  const empty = emptyEditable()
  rules.value.rules = empty.rules
  rules.value.groups = empty.groups
  rules.value.location = empty.location
  rules.value.keywordIds = undefined
}

const ruleCount = computed(() => (ruleFilter.value?.rules?.length ?? 0) + (ruleFilter.value?.groups?.length ?? 0))
watch(
  () => JSON.stringify(ruleFilter.value ?? null),
  () => {
    pageIndex.value = 0
  }
)


/** Defaults that differ from the plain list: shown in the badge of the filters button. */
const flagCount = computed(
  () =>
    Number(archived.value !== "active") +
    Number(includeBlacklisted.value) +
    Number(analysed.value !== "all") +
    Number(accountId.value !== ALL_ACCOUNTS)
)

const { accounts, accountId, hhAccountId, scopeKey, defaultAccountId } = useAccountFilter(ALL_ACCOUNTS)

// Any change of what is listed starts from the first page.
watch([analysed, archived, includeBlacklisted, search, sortKey, sortDirection, accountId], () => {
  pageIndex.value = 0
})

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

const listQuery = useQuery({
  key: () =>
    vacancyKeys.list({
      analysed: analysed.value,
      respondedAccountId: scopeKey.value,
      search: search.value,
      sort: `${serverSort.value.key}:${serverSort.value.direction}`,
      page: String(pageIndex.value),
      pageSize: PAGE_SIZE,
      includeArchived: archived.value === "all",
      includeBlacklisted: includeBlacklisted.value,
      hhAccountId: scopeKey.value,
      filter: JSON.stringify(ruleFilter.value ?? null)
    }),
  query: () =>
    vacancyApi.list({
      limit: PAGE_SIZE,
      offset: pageIndex.value * PAGE_SIZE,
      analysed: analysed.value === "all" ? undefined : analysed.value === "yes",
      respondedAccountId: hhAccountId.value,
      search: search.value === "" ? undefined : search.value,
      sort: serverSort.value,
      includeArchived: archived.value === "all",
      includeBlacklisted: includeBlacklisted.value,
      hhAccountId: hhAccountId.value,
      filter: ruleFilter.value
    })
})

const vacancies = computed<ReadonlyArray<VacancySummary>>(() => listQuery.data.value?.items ?? [])
const total = computed(() => listQuery.data.value?.total ?? 0)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isLoading = computed(() => listQuery.isLoading.value)

const refresh = () => {
  void listQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Вакансии"
      description="Корпус вакансий: сортировка по любому полю. Новые вакансии появляются через расписания на странице «Обход»."
    >
      <template #actions>
        <Button variant="outline" as-child>
          <a href="/schedules">Обход</a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="listQuery.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансии</AlertTitle>
      <AlertDescription>{{ describeError(listQuery.error.value) }}</AlertDescription>
    </Alert>

    <div class="mb-3 space-y-2">
      <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
        @click="rulesOpen = !rulesOpen"
      >
        <ListFilter class="h-3.5 w-3.5" />
        Фильтры и правила
        <Badge v-if="ruleCount + flagCount > 0" variant="neutral" class="text-[10px]">{{ ruleCount + flagCount }}</Badge>
      </button>
      <Select v-if="presets.length > 0" model-value="" @update:model-value="applyPreset">
        <SelectTrigger class="inline-flex h-8 w-[190px] text-xs">
          <SelectValue placeholder="Применить пресет…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">
            {{ preset.title }}
          </SelectItem>
        </SelectContent>
      </Select>
      <button
        v-if="ruleCount > 0"
        type="button"
        class="h-8 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="clearRules"
      >
        Сбросить
      </button>
      </div>
      <div v-show="rulesOpen || ruleCount > 0" class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted-foreground">По умолчанию</span>
          <Select :model-value="archived" @update:model-value="archived = String($event)">
            <SelectTrigger class="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in vacancyArchiveOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="includeBlacklisted ? 'show' : 'hide'" @update:model-value="includeBlacklisted = $event === 'show'">
            <SelectTrigger class="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in blacklistVisibilityOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="analysed" @update:model-value="analysed = String($event)">
            <SelectTrigger class="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in vacancyAnalysedOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="accountId" @update:model-value="accountId = String($event)">
            <SelectTrigger class="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in accountFilterOptions(accounts, defaultAccountId)" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <RuleBuilder v-model="rules" :flags="false" />
      </div>
    </div>

    <div class="mb-1 flex flex-wrap items-center gap-2 border-b border-border pb-3">
      <Input
        class="h-8 w-[260px] text-xs"
        placeholder="Название, компания или город"
        aria-label="Поиск"
        :model-value="search"
        @update:model-value="applySearch(String($event))"
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 py-2">
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Сортировка</span>
        <Select :model-value="sortKey" @update:model-value="changeSortKey">
          <SelectTrigger class="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" class="h-8 w-8" :aria-label="sortDirection === 'asc' ? 'По возрастанию' : 'По убыванию'" @click="toggleDirection">
          <ArrowUpNarrowWide v-if="sortDirection === 'asc'" />
          <ArrowDownNarrowWide v-else />
        </Button>
        <span class="ml-2">Найдено {{ total }}</span>
      </div>
    </div>

    <div v-if="listQuery.isPending.value" class="divide-y divide-border border-y border-border">
      <div v-for="n in 8" :key="n" class="px-3 py-4"><Skeleton class="h-10 w-full" /></div>
    </div>
    <EmptyState
      v-else-if="vacancies.length === 0"
      title="Вакансий не найдено"
      description="Измените запрос или включите архивные. Если корпус пуст, создайте расписание поиска на странице «Обход» и запустите его."
    />
    <div v-else class="divide-y divide-border border-y border-border">
      <RowFeed
        v-for="vacancy in vacancies"
        :key="vacancy.id"
        :vacancy="vacancy"
        :responded="vacancy.responded ?? []"
        :accounts="accounts"
        :resumes="resumes"
      />
    </div>

    <div class="flex items-center justify-between py-3 text-xs text-muted-foreground">
      <span>Страница {{ pageIndex + 1 }} из {{ pageCount }}</span>
      <div class="flex gap-1">
        <Button variant="outline" size="sm" :disabled="pageIndex === 0" @click="pageIndex -= 1">Назад</Button>
        <Button variant="outline" size="sm" :disabled="pageIndex + 1 >= pageCount" @click="pageIndex += 1">Вперёд</Button>
      </div>
    </div>
  </section>
</template>
