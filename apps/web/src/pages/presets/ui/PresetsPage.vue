<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { PresetRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { presetApi, presetKeys } from "@/entities/preset"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  payloadPreview,
  payloadText,
  presetKindLabel
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
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const kind = ref("all")

const query = useQuery({
  key: () => presetKeys.list(kind.value),
  query: () =>
    presetApi.list({
      kind: kind.value === "all" ? undefined : kind.value
    })
})

const presets = computed<ReadonlyArray<PresetRecord>>(() => query.data.value ?? [])

const columns: ColumnDef<PresetRecord>[] = [
  {
    accessorKey: "title",
    header: sortableHeader<PresetRecord>("Название"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[320px]" }, [
        h("div", { class: "font-medium" }, row.original.title),
        h("code", { class: "text-[11px] text-muted-foreground" }, row.original.id)
      ])
  },
  {
    id: "kind",
    accessorFn: (row) => presetKindLabel(row.kind),
    header: sortableHeader<PresetRecord>("Тип"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.kind === "apply" ? "info" : "secondary" },
        () => presetKindLabel(row.original.kind)
      )
  },
  {
    id: "system",
    accessorFn: (row) => (row.system ? "системный" : "пользовательский"),
    header: sortableHeader<PresetRecord>("Системный"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.system ? "outline" : "neutral" },
        () => (row.original.system ? "системный" : "пользовательский")
      )
  },
  {
    id: "filter",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Фильтр",
    cell: ({ row }) =>
      h("div", { class: "max-w-[420px]" }, [
        h("details", null, [
          h(
            "summary",
            { class: "cursor-pointer font-mono text-xs text-muted-foreground" },
            payloadPreview(row.original.filter)
          ),
          h(
            "pre",
            {
              class:
                "mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
            },
            payloadText(row.original.filter)
          )
        ])
      ])
  },
  {
    accessorKey: "updatedAt",
    header: sortableHeader<PresetRecord>("Обновлён"),
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
      title="Пресеты"
      description="Сохранённые фильтры корпуса: что искать и по каким правилам откликаться."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить пресеты</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="presets"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="Название пресета"
      empty-title="Пресетов нет"
      empty-description="Создайте пресет через CLI, чтобы фильтровать корпус и поток откликов."
    >
      <template #toolbar>
        <div class="space-y-1.5">
          <Label for="preset-kind" class="text-xs text-muted-foreground">Тип</Label>
          <Select v-model="kind">
            <SelectTrigger id="preset-kind" class="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              <SelectItem value="explore">Поиск (explore)</SelectItem>
              <SelectItem value="apply">Отклики (apply)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span class="pb-2 text-xs text-muted-foreground">Пресетов: {{ presets.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
