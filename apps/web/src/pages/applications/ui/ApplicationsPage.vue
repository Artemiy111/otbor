<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { ApplicationRecord, HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { AccountChip, hhAccountNameById, useAccountScope } from "@/entities/hh-account"
import { ApplicationStateFilter } from "@/features/application-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationPath,
  describeError,
  formatDate,
  statusLabel,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  DataTable,
  StatusBadge,
  sortableHeader,
  textColumn
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const state = ref("all")
const { accounts, accountId, hhAccountId } = useAccountScope()

const query = useQuery({
  key: () => applicationKeys.list(state.value, accountId.value),
  query: () =>
    applicationApi.list({
      limit: 200,
      state: state.value === "all" ? undefined : state.value,
      hhAccountId: hhAccountId.value
    })
})

const applications = computed<ReadonlyArray<ApplicationRecord>>(() => query.data.value ?? [])

const columns: ColumnDef<ApplicationRecord>[] = [
  {
    id: "state",
    accessorFn: (row) => statusLabel(row.state),
    header: sortableHeader<ApplicationRecord>("Состояние"),
    cell: ({ row }) =>
      h("div", null, [
        h(StatusBadge, { value: row.original.state }),
        row.original.streamId
          ? h("div", { class: "mt-1 text-xs text-muted-foreground" }, [
              "поток ",
              h("code", { class: "font-mono" }, row.original.streamId)
            ])
          : null
      ])
  },
  {
    id: "vacancy",
    accessorFn: (row) => row.vacancyTitle ?? row.vacancyId,
    header: sortableHeader<ApplicationRecord>("Вакансия"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[380px]" }, [
        h(
          "a",
          {
            href: applicationPath(row.original.id),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          row.original.vacancyTitle ?? row.original.vacancyId
        ),
        h("div", { class: "text-xs text-muted-foreground" }, [
          h(
            "a",
            { href: vacancyPath(row.original.vacancyId), class: "hover:text-foreground" },
            "вакансия"
          )
        ])
      ])
  },
  textColumn<ApplicationRecord>({
    id: "employer",
    title: "Компания",
    accessorFn: (row) => row.employerName ?? ""
  }),
  {
    id: "hhAccountId",
    accessorFn: (row) => hhAccountNameById(accounts.value, row.hhAccountId),
    header: sortableHeader<ApplicationRecord>("Аккаунт"),
    cell: ({ row }) =>
      h(AccountChip, { accountId: row.original.hhAccountId, accounts: accounts.value })
  },
  {
    accessorKey: "updatedAt",
    header: sortableHeader<ApplicationRecord>("Обновлён"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.updatedAt)
      )
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Отклики"
      description="Один устойчивый процесс на отклик. Состоянием владеет облако, а не harness."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отклики</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="applications"
      :is-loading="query.isPending.value"
      :loading-row-count="8"
      filter
      filter-label="Поиск"
      filter-placeholder="Вакансия, компания или аккаунт"
      empty-title="Откликов не найдено"
      empty-description="Отклик появится здесь, когда решение станет рабочим процессом."
    >
      <template #toolbar>
        <ApplicationStateFilter v-model="state" />
        <span class="pb-2 text-xs text-muted-foreground">Показано: {{ applications.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
