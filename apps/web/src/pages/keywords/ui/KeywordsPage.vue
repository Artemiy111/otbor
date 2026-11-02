<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { LexiconKeyword } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Search } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatNumber } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const appliedQuery = ref("")
const draft = ref("")

const query = useQuery({
  key: () => keywordKeys.list(appliedQuery.value),
  query: () =>
    keywordApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: 1000
    })
})

const keywords = computed<ReadonlyArray<LexiconKeyword>>(() => query.data.value ?? [])
const enabledCount = computed(() => keywords.value.filter((keyword) => keyword.enabled).length)

const search = () => {
  appliedQuery.value = draft.value.trim()
}

const reset = () => {
  draft.value = ""
  appliedQuery.value = ""
}

const refresh = () => {
  void query.refetch()
}

const columns: ColumnDef<LexiconKeyword>[] = [
  {
    accessorKey: "term",
    header: sortableHeader<LexiconKeyword>("Термин"),
    cell: ({ row }) =>
      h("div", null, [
        h("div", { class: "font-medium" }, row.original.term),
        h("code", { class: "text-[11px] text-muted-foreground" }, row.original.normalizedTerm)
      ])
  },
  {
    id: "aliases",
    accessorFn: (row) => row.aliases.map((alias) => alias.alias).join(" "),
    enableGlobalFilter: false,
    header: sortableHeader<LexiconKeyword>("Алиасы"),
    cell: ({ row }) => {
      const aliases = row.original.aliases
      if (aliases.length === 0) return h("span", { class: "text-sm text-muted-foreground" }, "—")
      return h(
        "div",
        { class: "flex flex-wrap gap-1" },
        aliases.map((alias) =>
          h(
            Badge,
            {
              key: alias.id,
              variant: "secondary",
              class: "font-normal",
              title: `${alias.matchType}${alias.typo ? " · опечатка" : ""}`
            },
            () => [
              alias.alias,
              alias.typo
                ? h("span", { class: "ml-1 text-[10px] opacity-60" }, "опечатка")
                : null
            ]
          )
        )
      )
    }
  },
  {
    accessorKey: "enabled",
    header: sortableHeader<LexiconKeyword>("Состояние"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.enabled ? "success" : "neutral" },
        () => (row.original.enabled ? "Включено" : "Выключено")
      )
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Ключевые слова"
      description="Словарь терминов и алиасов. Включённые слова участвуют в разборе вакансий."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label for="keyword-search" class="text-xs text-muted-foreground">Поиск по слову или алиасу</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="keyword-search"
            v-model="draft"
            type="text"
            placeholder="Например, Kubernetes или k8s"
            class="pl-9"
          />
        </div>
      </div>
      <Button type="submit" :disabled="query.isLoading.value">Найти</Button>
      <Button type="button" variant="outline" :disabled="query.isLoading.value" @click="reset">
        Сбросить
      </Button>
    </form>

    <p class="mb-3 text-xs text-muted-foreground">
      Терминов: {{ formatNumber(keywords.length) }} · включено: {{ formatNumber(enabledCount) }}
    </p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить словарь</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="keywords"
      :is-loading="query.isPending.value"
      :loading-row-count="8"
      :empty-title="appliedQuery === '' ? 'Словарь пуст' : 'Ничего не найдено'"
      empty-description="Добавьте термины через CLI или измените поисковый запрос."
    />
  </section>
</template>
