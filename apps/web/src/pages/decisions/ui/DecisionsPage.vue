<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { DecisionRecord, HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, FilePlus2 } from "@lucide/vue"
import { applicationApi } from "@/entities/application"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { applicationKeys } from "@/entities/application/model"
import { AccountChip, hhAccountNameById, useAccountFilter } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import { decisionVerdictOptions } from "@/features/decision-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationPath,
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
  Button,
  DataTable,
  StatusBadge,
  filterableHeader,
  sortableHeader
} from "@/shared/ui"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { PageHeader } from "@/widgets/page-header"

const verdict = ref("all")
const { accounts, accountId, hhAccountId, scopeKey, defaultAccountId } = useAccountFilter()

const query = useQuery({
  key: () => decisionKeys.list(verdict.value, scopeKey.value),
  query: () =>
    decisionApi.list({
      limit: 200,
      verdict: verdict.value === "all" ? undefined : verdict.value,
      hhAccountId: hhAccountId.value
    })
})

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

const decisions = computed<ReadonlyArray<DecisionRecord>>(() => query.data.value ?? [])

const queryCache = useQueryCache()
const creatingDecisionId = ref<string | null>(null)

const createMutation = useMutation({
  mutation: (decision: DecisionRecord) => {
    if (decision.hhAccountId === null || decision.hhAccountId === undefined) {
      throw new Error("Для решения не выбран hh-аккаунт")
    }
    return applicationApi.createFromDecision({
      decisionId: decision.id,
      hhAccountId: decision.hhAccountId,
      resumeId: decision.resumeId ?? undefined,
      mode: "drafts"
    })
  },
  async onSuccess(application) {
    await Promise.all([
      queryCache.invalidateQueries({ key: applicationKeys.all }),
      query.refetch()
    ])
    creatingDecisionId.value = null
    // Navigate to the new application? Keep simple: store last created id.
    void application
  },
  onError() {
    creatingDecisionId.value = null
  }
})

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
                    title: reason.detail ? `${reason.code}: ${reason.detail}` : reason.code
                  },
                  () => [
                    decisionReasonLabel(reason.code),
                    reason.detail ? `: ${reason.detail}` : null,
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
    header: filterableHeader<DecisionRecord>("Вердикт", {
      value: () => verdict.value,
      options: () => decisionVerdictOptions,
      onChange: (value) => (verdict.value = value)
    }),
    cell: ({ row }) => h(StatusBadge, { value: row.original.verdict })
  },
  {
    id: "gate",
    accessorFn: (row) => statusLabel(row.gate),
    header: sortableHeader<DecisionRecord>("Проверка"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.gate })
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
    id: "account",
    accessorFn: (row) => hhAccountNameById(accounts.value, row.hhAccountId),
    header: filterableHeader<DecisionRecord>("Аккаунт", {
      value: () => accountId.value,
      options: () => accountFilterOptions(accounts.value, defaultAccountId.value),
      onChange: (value) => (accountId.value = value)
    }),
    cell: ({ row }) =>
      h(AccountChip, {
        accountId: row.original.hhAccountId,
        accounts: accounts.value,
        resumeIds: [row.original.resumeId],
        resumes: resumes.value
      })
  },
  {
    id: "role",
    accessorFn: (row) => row.roleFamily ?? "",
    header: sortableHeader<DecisionRecord>("Роль"),
    cell: ({ row }) => h("span", null, roleFamilyLabel(row.original.roleFamily))
  },
  {
    id: "actions",
    header: "Действия",
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const decision = row.original
      const hasAccount = decision.hhAccountId !== null && decision.hhAccountId !== undefined
      if (!hasAccount) {
        return h("span", { class: "text-xs text-muted-foreground" }, "нет аккаунта")
      }
      const isCreating = creatingDecisionId.value === decision.id || createMutation.isLoading.value
      return h(
        Button,
        {
          size: "sm",
          variant: "outline",
          disabled: isCreating,
          onClick: () => {
            creatingDecisionId.value = decision.id
            createMutation.mutate(decision)
          }
        },
        () => [
          h(FilePlus2, { class: "mr-1 h-3.5 w-3.5" }),
          isCreating ? "Создание..." : "Черновик"
        ]
      )
    }
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
        <span class="pb-2 text-xs text-muted-foreground">Показано: {{ decisions.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
