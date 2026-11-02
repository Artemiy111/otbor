<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { DecisionRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { DecisionVerdictFilter } from "@/features/decision-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  decisionReasonLabel,
  describeError,
  formatDate,
  formatPriority,
  roleFamilyLabel,
  statusLabel,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  DataTable,
  StatusBadge,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const verdict = ref("all")

const query = useQuery({
  key: () => decisionKeys.list(verdict.value),
  query: () =>
    decisionApi.list({
      limit: 200,
      verdict: verdict.value === "all" ? undefined : verdict.value
    })
})

const decisions = computed<ReadonlyArray<DecisionRecord>>(() => query.data.value ?? [])

const columns: ColumnDef<DecisionRecord>[] = [
  {
    id: "vacancy",
    accessorFn: (row) => row.vacancyTitle ?? row.vacancyId,
    header: sortableHeader<DecisionRecord>("Вакансия"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[360px]" }, [
        h(
          "a",
          {
            href: vacancyPath(row.original.vacancyId),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          row.original.vacancyTitle ?? row.original.vacancyId
        ),
        row.original.reasons.length > 0
          ? h(
              "div",
              { class: "mt-1 flex flex-wrap gap-1" },
              row.original.reasons.map((reason) =>
                h(
                  Badge,
                  {
                    key: reason.code + (reason.detail ?? ""),
                    variant: "secondary",
                    class: "font-normal",
                    title: reason.code
                  },
                  () => [
                    decisionReasonLabel(reason.code),
                    h("span", { class: "ml-1 font-mono text-[10px] opacity-60" }, reason.code)
                  ]
                )
              )
            )
          : null
      ])
  },
  {
    id: "verdict",
    accessorFn: (row) => statusLabel(row.verdict),
    header: sortableHeader<DecisionRecord>("Вердикт"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.verdict, raw: true })
  },
  {
    id: "gate",
    accessorFn: (row) => statusLabel(row.gate),
    header: sortableHeader<DecisionRecord>("Проверка"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.gate, raw: true })
  },
  {
    accessorKey: "fit",
    header: sortableHeader<DecisionRecord>("Соответствие"),
    cell: ({ row }) => h("span", { class: "tabular-nums" }, String(row.original.fit))
  },
  {
    accessorKey: "priority",
    header: sortableHeader<DecisionRecord>("Приоритет"),
    cell: ({ row }) =>
      h("span", { class: "font-mono tabular-nums" }, formatPriority(row.original.priority))
  },
  {
    id: "role",
    accessorFn: (row) => row.roleFamily ?? "",
    header: sortableHeader<DecisionRecord>("Роль"),
    cell: ({ row }) => h("span", null, roleFamilyLabel(row.original.roleFamily))
  },
  {
    accessorKey: "createdAt",
    header: sortableHeader<DecisionRecord>("Создано"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.createdAt)
      )
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Решения"
      description="Сохранённые вердикты отбора, новые сверху. Решение не пересчитывается для показа."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить решения</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="decisions"
      :is-loading="query.isPending.value"
      :loading-row-count="8"
      filter
      filter-label="Поиск"
      filter-placeholder="Вакансия, вердикт или роль"
      empty-title="Решений не найдено"
      empty-description="Оцените вакансию, чтобы сохранить артефакт решения."
    >
      <template #toolbar>
        <DecisionVerdictFilter v-model="verdict" />
        <span class="pb-2 text-xs text-muted-foreground">Показано: {{ decisions.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
