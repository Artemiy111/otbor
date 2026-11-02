<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { GateVerdict, VacancySummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { VacancyGateFilter } from "@/features/vacancy-filter"
import { RefreshButton } from "@/features/refresh-button"
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
  DataTable,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 25
const LOAD_LIMIT = 200

const gate = ref("all")
const archived = ref("active")

const gateCache = new Map<string, GateVerdict>()

const listQuery = useQuery({
  key: () =>
    vacancyKeys.list({
      gate: gate.value,
      includeArchived: archived.value === "all"
    }),
  query: () =>
    vacancyApi.list({
      limit: LOAD_LIMIT,
      offset: 0,
      gate: gate.value === "all" ? undefined : gate.value,
      includeArchived: archived.value === "all"
    })
})

const vacancies = computed<ReadonlyArray<VacancySummary>>(
  () => listQuery.data.value?.items ?? []
)
const total = computed(() => listQuery.data.value?.total ?? vacancies.value.length)

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
    header: sortableHeader<VacancySummary>("Вакансия"),
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
              : null
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
    header: "Гейт",
    cell: ({ row }) => {
      const verdict = gateFor(row.original.title)
      if (verdict !== null) return h(StatusBadge, { value: verdict })
      return gatesQuery.isPending.value
        ? h("span", { class: "text-xs text-muted-foreground" }, "…")
        : h("span", { class: "text-xs text-muted-foreground" }, "—")
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
      description="Корпус вакансий глазами гейта: заголовок, компания, зарплата, город и вердикт."
    >
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="listQuery.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансии</AlertTitle>
      <AlertDescription>{{ describeError(listQuery.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="vacancies"
      :is-loading="listQuery.isPending.value"
      :loading-row-count="8"
      :page-size="PAGE_SIZE"
      filter
      filter-label="Поиск"
      filter-placeholder="Название, компания или город"
      empty-title="Вакансий не найдено"
      empty-description="Измените запрос, фильтр гейта или включите архивные вакансии."
      @update:visible-rows="visibleRows = $event"
    >
      <template #toolbar>
        <VacancyGateFilter v-model="gate" />
        <div class="space-y-1.5">
          <Label for="vacancy-archived" class="text-xs text-muted-foreground">Архив</Label>
          <Select v-model="archived">
            <SelectTrigger id="vacancy-archived" class="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Только активные</SelectItem>
              <SelectItem value="all">С архивными</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </template>

      <template #summary="{ table }">
        <p class="mb-3 text-xs text-muted-foreground">
          Найдено {{ table.getFilteredRowModel().rows.length }} из {{ total }} · страница
          {{ table.getState().pagination.pageIndex + 1 }} из
          {{ Math.max(1, table.getPageCount()) }}
          <span v-if="total > LOAD_LIMIT"> · показаны первые {{ LOAD_LIMIT }} записей</span>
        </p>
      </template>
    </DataTable>
  </section>
</template>
