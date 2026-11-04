<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { EmployerSummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { ChevronLeft, ChevronRight, CircleAlert, Search } from "@lucide/vue"
import { companyApi, companyKeys } from "@/entities/company"
import { RefreshButton } from "@/features/refresh-button"
import { companyPath, describeError, formatNumber, formatRating } from "@/shared/lib"
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

const PAGE_SIZE = 50

const appliedQuery = ref("")
const draft = ref("")
const offset = ref(0)
const includeBlacklisted = ref(false)

const query = useQuery({
  key: () =>
    companyKeys.list({
      query: appliedQuery.value,
      offset: offset.value,
      includeBlacklisted: includeBlacklisted.value,
    }),
  query: () =>
    companyApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: PAGE_SIZE,
      offset: offset.value,
      includeBlacklisted: includeBlacklisted.value
    })
})

const companies = computed<ReadonlyArray<EmployerSummary>>(
  () => query.data.value?.items ?? []
)
const total = computed(() => query.data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)

watch(totalPages, (pages) => {
  if (page.value > pages) offset.value = (pages - 1) * PAGE_SIZE
})

const search = () => {
  appliedQuery.value = draft.value.trim()
  offset.value = 0
}

const reset = () => {
  draft.value = ""
  appliedQuery.value = ""
  offset.value = 0
}

const refresh = () => {
  void query.refetch()
}

const columns: ColumnDef<EmployerSummary>[] = [
  {
    accessorKey: "name",
    header: sortableHeader<EmployerSummary>("Компания"),
    cell: ({ row }) =>
      h("div", { class: "flex items-center gap-2.5" }, [
        row.original.logoUrl
          ? h("img", {
              src: row.original.logoUrl,
              alt: row.original.name,
              class: "size-8 shrink-0 rounded-md border bg-white object-contain",
              loading: "lazy"
            })
          : null,
        h(
          "a",
          {
            href: companyPath(row.original.id),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          row.original.name
        )
      ])
  },
  {
    id: "rating",
    accessorFn: (row) => row.rating ?? null,
    enableGlobalFilter: false,
    header: sortableHeader<EmployerSummary>("Рейтинг"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap" }, [
        h("span", { class: "text-amber-400" }, "★"),
        ` ${formatRating(row.original.rating)}`,
        row.original.reviewsCount
          ? h(
              "span",
              { class: "text-xs text-muted-foreground" },
              ` · ${formatNumber(row.original.reviewsCount)} отзывов`
            )
          : null
      ])
  },
  {
    id: "industries",
    accessorFn: (row) => row.industries.join(", "),
    enableGlobalFilter: false,
    header: sortableHeader<EmployerSummary>("Отрасли"),
    cell: ({ row }) => {
      const industries = row.original.industries
      if (industries.length === 0) return h("span", { class: "text-muted-foreground" }, "—")
      return h("div", { class: "flex flex-wrap gap-1" }, [
        ...industries
          .slice(0, 3)
          .map((industry) =>
            h(Badge, { key: industry, variant: "secondary", class: "font-normal" }, () => industry)
          ),
        industries.length > 3
          ? h(Badge, { variant: "outline" }, () => `+${industries.length - 3}`)
          : null
      ])
    }
  },
  {
    id: "blacklisted",
    accessorFn: (row) => row.blacklisted,
    header: sortableHeader<EmployerSummary>("Чёрный список"),
    cell: ({ row }) => {
      const layers = row.original.blacklistLayers ?? []
      if (!row.original.blacklisted) {
        return h("span", { class: "text-xs text-muted-foreground" }, "—")
      }
      return h("div", { class: "flex flex-wrap gap-1" }, [
        h(Badge, { variant: "destructive", class: "text-[10px]" }, () => "Заблокирована"),
        ...layers.map((layer) =>
          h(Badge, { key: layer, variant: "outline", class: "text-[10px]" }, () => layer)
        )
      ])
    }
  },
  {
    accessorKey: "vacancyCount",
    header: sortableHeader<EmployerSummary>("Вакансии", "right"),
    cell: ({ row }) =>
      h("div", { class: "text-right tabular-nums" }, formatNumber(row.original.vacancyCount))
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Компании"
      description="Работодатели из корпуса: рейтинг, отрасли и число сохранённых вакансий."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label for="company-search" class="text-xs text-muted-foreground">Поиск по названию</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="company-search"
            v-model="draft"
            type="text"
            placeholder="Например, Яндекс"
            class="pl-9"
          />
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="includeBlacklisted" type="checkbox" class="size-4 rounded border-input accent-primary" />
        Показывать заблокированные
      </label>
      <Button type="submit" :disabled="query.isLoading.value">Найти</Button>
      <Button type="button" variant="outline" :disabled="query.isLoading.value" @click="reset">
        Сбросить
      </Button>
      <div class="flex-1" />
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="offset === 0 || query.isLoading.value"
          @click="offset = Math.max(0, offset - PAGE_SIZE)"
        >
          <ChevronLeft class="h-4 w-4" />
          Назад
        </Button>
        <span class="text-xs text-muted-foreground">{{ page }} / {{ totalPages }}</span>
        <Button
          variant="outline"
          size="sm"
          :disabled="offset + PAGE_SIZE >= total || query.isLoading.value"
          @click="offset += PAGE_SIZE"
        >
          Вперёд
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>
    </form>

    <p class="mb-3 text-xs text-muted-foreground">
      Найдено компаний: {{ formatNumber(total) }}
      <span v-if="appliedQuery !== ''"> по запросу «{{ appliedQuery }}»</span>
    </p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить компании</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="companies"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      empty-title="Компании не найдены"
      empty-description="Измените запрос или сохраните вакансии, чтобы работодатели появились в корпусе."
    />
  </section>
</template>
