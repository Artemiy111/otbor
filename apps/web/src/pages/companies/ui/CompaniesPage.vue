<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { EmployerSummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { ChevronLeft, ChevronRight, CircleAlert, Search } from "@lucide/vue"
import { companyApi, companyKeys } from "@/entities/company"
import { AccountChip, ALL_ACCOUNTS, useAccountFilter } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import { companyBlacklistOptions, parseCompanyBlacklistFilter } from "@/features/blacklist-filter"
import { RefreshButton } from "@/features/refresh-button"
import { companyPath, describeError, employerLogoSrc, formatNumber, formatRating } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  filterableHeader,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 50

const appliedQuery = ref("")
const draft = ref("")
const offset = ref(0)
const blacklistFilter = ref("hide")
const { accounts, accountId, hhAccountId, scopeKey, defaultAccountId } = useAccountFilter(ALL_ACCOUNTS)

const query = useQuery({
  key: () =>
    companyKeys.list({
      query: appliedQuery.value,
      offset: offset.value,
      blacklistView: blacklistFilter.value,
      respondedAccountId: scopeKey.value
    }),
  query: () =>
    companyApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: PAGE_SIZE,
      offset: offset.value,
      ...parseCompanyBlacklistFilter(blacklistFilter.value),
      respondedAccountId: hhAccountId.value
    })
})

const companies = computed<ReadonlyArray<EmployerSummary>>(
  () => query.data.value?.items ?? []
)
const total = computed(() => query.data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)

// A filter change starts from the first page.
watch([hhAccountId, blacklistFilter], () => {
  offset.value = 0
})

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
        employerLogoSrc(row.original.id, row.original.logoUrl)
          ? h("img", {
              src: employerLogoSrc(row.original.id, row.original.logoUrl)!,
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
        h("span", { class: "text-warning" }, "★"),
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
    id: "accounts",
    enableSorting: false,
    enableGlobalFilter: false,
    header: filterableHeader<EmployerSummary>("Аккаунты", {
      value: () => accountId.value,
      options: () => accountFilterOptions(accounts.value, defaultAccountId.value),
      onChange: (value) => (accountId.value = value)
    }),
    cell: ({ row }) => {
      const ids = row.original.respondedAccountIds ?? []
      return ids.length === 0
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h(
            "div",
            { class: "flex flex-wrap gap-1" },
            ids.map((id) => h(AccountChip, { accountId: id, accounts: accounts.value }))
          )
    }
  },
  {
    id: "blacklisted",
    accessorFn: (row) => row.blacklisted,
    header: filterableHeader<EmployerSummary>("Чёрный список", {
      value: () => blacklistFilter.value,
      options: () => companyBlacklistOptions(accounts.value),
      onChange: (value) => (blacklistFilter.value = value)
    }),
    cell: ({ row }) => {
      if (!row.original.blacklisted) {
        return h("span", { class: "text-xs text-muted-foreground" }, "—")
      }
      const layers = row.original.blacklistLayers ?? []
      const blockedBy = row.original.blockedAccountIds ?? []
      return h("div", { class: "flex flex-wrap items-center gap-1" }, [
        layers.includes("app")
          ? h(
              Badge,
              { variant: "destructive", class: "text-xs", title: "Заблокирована на уровне приложения" },
              () => "Приложение"
            )
          : null,
        ...blockedBy.map((id) =>
          h(AccountChip, { key: id, accountId: id, accounts: accounts.value })
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
