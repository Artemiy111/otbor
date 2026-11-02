<script setup lang="ts">
import { computed, h } from "vue"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})

const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => query.data.value ?? [])

const columns: ColumnDef<HhAccountRecord>[] = [
  {
    accessorKey: "label",
    header: sortableHeader<HhAccountRecord>("Аккаунт"),
    cell: ({ row }) => h("span", { class: "font-medium" }, row.original.label)
  },
  {
    id: "name",
    accessorFn: (row) => [row.firstName, row.lastName].filter(Boolean).join(" "),
    header: sortableHeader<HhAccountRecord>("Имя"),
    cell: ({ row }) =>
      h("span", null, [row.original.firstName, row.original.lastName].filter(Boolean).join(" ") || "—")
  },
  {
    accessorKey: "areaName",
    header: sortableHeader<HhAccountRecord>("Регион"),
    cell: ({ row }) => h("span", null, row.original.areaName ?? "—")
  },
  {
    accessorKey: "sessionProfile",
    header: sortableHeader<HhAccountRecord>("Профиль сессии"),
    cell: ({ row }) =>
      h("span", { class: "font-mono text-xs" }, row.original.sessionProfile ?? "—")
  },
  {
    id: "default",
    accessorFn: (row) => (row.isDefault ? "да" : "нет"),
    header: sortableHeader<HhAccountRecord>("По умолчанию"),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.isDefault ? "success" : "secondary" }, () =>
        row.original.isDefault ? "Да" : "Нет"
      )
  },
  {
    accessorKey: "createdAt",
    header: sortableHeader<HhAccountRecord>("Создан"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.createdAt))
  }
]

const refresh = () => void query.refetch()
</script>

<template>
  <section>
    <PageHeader title="Аккаунты hh.ru" description="Соискательские аккаунты и привязанные сессии.">
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить аккаунты</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="accounts"
      :is-loading="query.isPending.value"
      :loading-row-count="4"
      empty-title="Аккаунтов нет"
      empty-description="Выполните otbor hh login, чтобы создать аккаунт."
    />
  </section>
</template>
