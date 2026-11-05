<script setup lang="ts">
import { computed, h, reactive, ref, watch } from "vue"
import { useDebounceFn } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import { applicationApi, respondedByVacancy } from "@/entities/application"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { AccountChip, ALL_ACCOUNTS, useAccountFilter } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import type { GateVerdict, VacancySort, VacancySortKey, VacancySummary } from "@otbor/contract"
import type { ColumnDef, PaginationState, SortingState } from "@tanstack/vue-table"
import { CircleAlert, ListFilter } from "@lucide/vue"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { blacklistVisibilityOptions } from "@/features/blacklist-filter"
import { vacancyAnalysedOptions, vacancyArchiveOptions, vacancyGateOptions } from "@/features/vacancy-filter"
import { RefreshButton } from "@/features/refresh-button"
import { RuleBuilder, buildFilter, emptyEditable } from "@/features/rule-builder"
import {
  companyPath,
  describeError,
  formatDate,
  formatSalary,
  seniorityLabel,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  StatusBadge,
  filterableHeader,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 25
const SORT_KEYS: ReadonlyArray<VacancySortKey> = ["title", "employer", "salary", "area", "date", "analysed"]

const gate = ref("all")
const analysed = ref("all")
const archived = ref("active")
const includeBlacklisted = ref(false)
/** Search, sort and page are sent to the server: they apply to every vacancy, not to a loaded slice. */
const search = ref("")
const sorting = ref<SortingState>([])
const pagination = ref<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE })

const applySearch = useDebounceFn((value: string) => {
  search.value = value
}, 300)

const serverSort = computed<VacancySort | undefined>(() => {
  const first = sorting.value[0]
  if (first === undefined || !SORT_KEYS.includes(first.id as VacancySortKey)) return undefined
  return { key: first.id as VacancySortKey, direction: first.desc ? "desc" : "asc" }
})

/** Ad-hoc rules: the same constructor as presets, applied on the server to the whole corpus. */
const rulesOpen = ref(false)
const rules = reactive(emptyEditable())
const ruleFilter = computed(() => {
  const built = buildFilter(rules)
  if (built.rules === undefined) return undefined
  // The header toggles own archive and blacklist visibility.
  return {
    ...built,
    ...(archived.value === "all" ? { includeArchived: true } : {}),
    ...(includeBlacklisted.value ? { includeBlacklisted: true } : {})
  }
})
const ruleCount = computed(() => ruleFilter.value?.rules?.length ?? 0)
watch(
  () => JSON.stringify(ruleFilter.value ?? null),
  () => {
    pagination.value = { ...pagination.value, pageIndex: 0 }
  }
)

const gateCache = new Map<string, GateVerdict>()

const { accounts, accountId, hhAccountId, scopeKey, defaultAccountId } = useAccountFilter(ALL_ACCOUNTS)

const applicationsQuery = useQuery({
  key: () => ["applications", "by-vacancy"],
  query: () => applicationApi.list({ limit: 2000 })
})
const respondedAccounts = computed(() => respondedByVacancy(applicationsQuery.data.value ?? []))
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

const listQuery = useQuery({
  key: () =>
    vacancyKeys.list({
      gate: gate.value,
      analysed: analysed.value,
      respondedAccountId: scopeKey.value,
      search: search.value,
      sort: serverSort.value === undefined ? "" : `${serverSort.value.key}:${serverSort.value.direction}`,
      page: String(pagination.value.pageIndex),
      pageSize: pagination.value.pageSize,
      includeArchived: archived.value === "all",
      includeBlacklisted: includeBlacklisted.value,
      hhAccountId: scopeKey.value,
      filter: JSON.stringify(ruleFilter.value ?? null)
    }),
  query: () =>
    vacancyApi.list({
      limit: pagination.value.pageSize,
      offset: pagination.value.pageIndex * pagination.value.pageSize,
      gate: gate.value === "all" ? undefined : gate.value,
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

const onSortingChange = (value: SortingState) => {
  sorting.value = value
}
const onGlobalFilterChange = (value: string) => {
  void applySearch(value)
}
const onPaginationChange = (value: PaginationState) => {
  pagination.value = value
}

const visibleRows = ref<ReadonlyArray<VacancySummary>>([])
const pageTitles = computed(() => [...new Set(visibleRows.value.map((vacancy) => vacancy.title))])

const gatesQuery = useQuery({
  key: () => ["vacancies", "gates", pageTitles.value] as const,
  query: async (): Promise<Record<string, GateVerdict>> => {
    const missing = pageTitles.value.filter((title) => !gateCache.has(title))
    const settled = await Promise.all(
      missing.map(async (title) => {
        try {
          const preview = await vacancyApi.titlePreview(title)
          return [title, preview.verdict] as const
        } catch {
          return [title, null] as const
        }
      })
    )
    for (const [title, verdict] of settled) {
      if (verdict !== null) gateCache.set(title, verdict)
    }
    const gates: Record<string, GateVerdict> = {}
    for (const title of pageTitles.value) {
      const verdict = gateCache.get(title)
      if (verdict !== undefined) gates[title] = verdict
    }
    return gates
  },
  enabled: () => pageTitles.value.length > 0
})

const gateFor = (title: string): GateVerdict | null => gatesQuery.data.value?.[title] ?? null
const isLoading = computed(() => listQuery.isLoading.value || gatesQuery.isLoading.value)

const columns: ColumnDef<VacancySummary>[] = [
  {
    accessorKey: "title",
    header: filterableHeader<VacancySummary>("Вакансия", {
      value: () => archived.value,
      options: () => vacancyArchiveOptions,
      onChange: (value) => (archived.value = value)
    }),
    cell: ({ row }) => {
      const vacancy = row.original
      return h("div", { class: "max-w-[420px]" }, [
        h(
          "a",
          {
            href: vacancyPath(vacancy.id),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          vacancy.title
        ),
        h(
          "div",
          { class: "mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" },
          [
            h("span", null, seniorityLabel(vacancy.seniority)),
            vacancy.archived
              ? h(Badge, { variant: "neutral", class: "text-[10px]" }, () => "архив")
              : null,
          ]
        )
      ])
    }
  },
  {
    id: "employer",
    accessorFn: (row) => row.employerName ?? "",
    header: sortableHeader<VacancySummary>("Компания"),
    cell: ({ row }) => {
      const vacancy = row.original
      return vacancy.employerId
        ? h(
            "a",
            {
              href: companyPath(vacancy.employerId),
              class: "text-foreground transition-colors hover:text-primary"
            },
            vacancy.employerName ?? "Без названия"
          )
        : h("span", null, vacancy.employerName ?? "—")
    }
  },
  {
    id: "salary",
    accessorFn: (row) => row.salaryFrom ?? row.salaryTo ?? null,
    enableGlobalFilter: false,
    header: sortableHeader<VacancySummary>("Зарплата"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap" },
        formatSalary(row.original.salaryFrom, row.original.salaryTo, row.original.salaryCurrency)
      )
  },
  {
    id: "area",
    accessorFn: (row) => row.areaName ?? "",
    header: sortableHeader<VacancySummary>("Город"),
    cell: ({ row }) => h("span", null, row.original.areaName ?? "—")
  },
  {
    id: "gate",
    enableSorting: false,
    enableGlobalFilter: false,
    header: filterableHeader<VacancySummary>("Проверка", {
      value: () => gate.value,
      options: () => vacancyGateOptions,
      onChange: (value) => (gate.value = value)
    }),
    cell: ({ row }) => {
      const verdict = gateFor(row.original.title)
      if (verdict !== null) return h(StatusBadge, { value: verdict })
      return gatesQuery.isPending.value
        ? h("span", { class: "text-xs text-muted-foreground" }, "…")
        : h("span", { class: "text-xs text-muted-foreground" }, "—")
    }
  },
  {
    id: "analysed",
    accessorFn: (row) => row.analysed === true,
    enableGlobalFilter: false,
    header: filterableHeader<VacancySummary>("ИИ-анализ", {
      value: () => analysed.value,
      options: () => vacancyAnalysedOptions,
      onChange: (value) => (analysed.value = value)
    }),
    cell: ({ row }) =>
      row.original.analysed
        ? h(Badge, { variant: "info", class: "text-[10px]" }, () => "проанализирована")
        : h("span", { class: "text-xs text-muted-foreground" }, "нет")
  },
  {
    id: "blacklisted",
    accessorFn: (row) => row.blacklisted,
    enableSorting: false,
    enableGlobalFilter: false,
    header: filterableHeader<VacancySummary>("Чёрный список", {
      value: () => (includeBlacklisted.value ? "show" : "hide"),
      options: () => blacklistVisibilityOptions,
      onChange: (value) => (includeBlacklisted.value = value === "show")
    }),
    cell: ({ row }) =>
      row.original.blacklisted
        ? h(Badge, { variant: "destructive", class: "text-[10px]" }, () => "заблокирована")
        : h("span", { class: "text-xs text-muted-foreground" }, "—")
  },
  {
    id: "accounts",
    enableSorting: false,
    enableGlobalFilter: false,
    header: filterableHeader<VacancySummary>("Аккаунты", {
      value: () => accountId.value,
      options: () => accountFilterOptions(accounts.value, defaultAccountId.value),
      onChange: (value) => (accountId.value = value)
    }),
    cell: ({ row }) => {
      const ids = respondedAccounts.value.get(row.original.id) ?? []
      return ids.length === 0
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h(
            "div",
            { class: "flex flex-wrap gap-1" },
            ids.map((item) =>
              h(AccountChip, {
                key: item.accountId,
                accountId: item.accountId,
                accounts: accounts.value,
                resumeIds: item.resumeIds,
                resumes: resumes.value
              })
            )
          )
    }
  },
  {
    id: "date",
    accessorFn: (row) => row.publishedAt ?? row.lastSeenAt,
    enableGlobalFilter: false,
    header: sortableHeader<VacancySummary>("Дата"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.publishedAt ?? row.original.lastSeenAt)
      )
  }
]

const refresh = () => {
  void listQuery.refetch()
  void gatesQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Вакансии"
      description="Корпус вакансий: заголовок, компания, зарплата, город и детерминированная проверка заголовка. Новые вакансии появляются через расписания на странице «Обход»."
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
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
        @click="rulesOpen = !rulesOpen"
      >
        <ListFilter class="h-3.5 w-3.5" />
        Правила
        <Badge v-if="ruleCount > 0" variant="neutral" class="text-[10px]">{{ ruleCount }}</Badge>
      </button>
      <div v-show="rulesOpen || ruleCount > 0">
        <RuleBuilder v-model="rules" :flags="false" />
      </div>
    </div>

    <DataTable
      :columns="columns"
      :data="vacancies"
      :is-loading="listQuery.isPending.value"
      :loading-row-count="8"
      :page-size="PAGE_SIZE"
      server-side
      :row-count="total"
      @update:sorting="onSortingChange"
      @update:global-filter="onGlobalFilterChange"
      @update:pagination="onPaginationChange"
      filter
      filter-label="Поиск"
      filter-placeholder="Название, компания или город"
      empty-title="Вакансий не найдено"
      empty-description="Измените запрос, проверку заголовка или включите архивные. Если корпус пуст, создайте расписание поиска на странице «Обход» и запустите его."
      @update:visible-rows="visibleRows = $event"
    >
      <template #summary="{ table }">
        <p class="mb-3 text-xs text-muted-foreground">
          Проверка заголовка — правило, не ИИ: «подходит» значит, что заголовок похож на
          DevOps/SRE-роль, «неясно» уходит в тихий список, «отклонено» — жёсткий минус.
          Колонка «ИИ-анализ» показывает, есть ли у вакансии разбор локальной моделью для текущей версии промпта.
        </p>
        <p class="mb-3 text-xs text-muted-foreground">
          Найдено {{ total }} · страница {{ table.getState().pagination.pageIndex + 1 }} из
          {{ Math.max(1, table.getPageCount()) }}
        </p>
      </template>
    </DataTable>
  </section>
</template>
