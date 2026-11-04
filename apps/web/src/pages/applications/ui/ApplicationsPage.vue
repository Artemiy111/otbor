<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { ApplicationRecord, HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import PrototypeAccountResume from "./PrototypeAccountResume.vue"
import PrototypeSwitcher from "./PrototypeSwitcher.vue"
import { resumeApi } from "@/entities/resume"
import { applicationApi, applicationKeys } from "@/entities/application"
import { AccountChip, hhAccountNameById, useAccountFilter } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import { applicationStateOptions } from "@/features/application-filter"
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
  filterableHeader,
  sortableHeader,
  textColumn
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const state = ref("all")
const { accounts, accountId, hhAccountId, scopeKey, defaultAccountId } = useAccountFilter()

const query = useQuery({
  key: () => applicationKeys.list(state.value, scopeKey.value),
  query: () =>
    applicationApi.list({
      limit: 200,
      state: state.value === "all" ? undefined : state.value,
      hhAccountId: hhAccountId.value
    })
})

// PROTOTYPE
const protoVariants = [
  { key: "A", label: "Кружок + бейдж резюме" },
  { key: "B", label: "Метка резюме на кружке" },
  { key: "C", label: "Кружок + hovercard" },
  { key: "D", label: "Составная плашка" }
]
const variant = ref(new URLSearchParams(window.location.search).get("variant") ?? "A")
const resumesQuery = useQuery({ key: () => ["proto-resumes"], query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

const applications = computed<ReadonlyArray<ApplicationRecord>>(() => query.data.value ?? [])

const columns: ColumnDef<ApplicationRecord>[] = [
  {
    id: "state",
    accessorFn: (row) => statusLabel(row.state),
    header: filterableHeader<ApplicationRecord>("Состояние", {
      value: () => state.value,
      options: () => applicationStateOptions,
      onChange: (value) => (state.value = value)
    }),
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
    header: filterableHeader<ApplicationRecord>("Аккаунт", {
      value: () => accountId.value,
      options: () => accountFilterOptions(accounts.value, defaultAccountId.value),
      onChange: (value) => (accountId.value = value)
    }),
    cell: ({ row }) =>
      h(PrototypeAccountResume, {
        variant: variant.value,
        accountId: row.original.hhAccountId,
        resumeId: row.original.resumeId,
        accounts: accounts.value,
        resumes: resumes.value
      })
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
        <span class="pb-2 text-xs text-muted-foreground">Показано: {{ applications.length }}</span>
      </template>
    </DataTable>
    <PrototypeSwitcher v-model="variant" :variants="protoVariants" />
  </section>
</template>
