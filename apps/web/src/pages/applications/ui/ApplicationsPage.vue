<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useMutation, useQuery } from "@pinia/colada"
import type { ApplicationRecord, HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { autoRunLabel } from "@/entities/auto-apply"
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
  Badge,
  Button,
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

const syncMessage = ref("")
const syncMutation = useMutation({
  mutation: async () => {
    const targets = hhAccountId.value ? [hhAccountId.value] : accounts.value.map((a) => a.id as string)
    const lines: string[] = []
    for (const id of targets) {
      const name = hhAccountNameById(accounts.value, id as HhAccountRecord["id"])
      let status = await applicationApi.syncRun(id)
      syncMessage.value = `${name}: задача в очереди, жду гарнесс…`
      const deadline = Date.now() + 180_000
      while (!["done", "failed", "needs_human"].includes(status.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        status = await applicationApi.syncStatus(id)
      }
      const c = status.counts
      lines.push(
        status.status === "done" && c
          ? `${name}: импортировано ${c.imported}, обновлено ${c.updated}, без изменений ${c.unchanged}` +
              (c.unknownVacancy > 0 ? `, вакансии нет в базе: ${c.unknownVacancy}` : "") +
              (c.complete ? "" : " (список прочитан не до конца)")
          : `${name}: ${status.status}${status.message ? ` — ${status.message}` : ""}`
      )
      syncMessage.value = lines.join(" · ")
    }
  },
  onSettled() {
    void query.refetch()
  }
})

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
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
        h("div", { class: "flex items-center gap-2 text-xs text-muted-foreground" }, [
          h(
            "a",
            { href: vacancyPath(row.original.vacancyId), class: "hover:text-foreground" },
            "вакансия"
          ),
          row.original.autoRun
            ? h(Badge, { variant: row.original.autoRun === "auto" ? "info" : "outline" }, () =>
                autoRunLabel(row.original.autoRun!)
              )
            : null
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
      h(AccountChip, {
        accountId: row.original.hhAccountId,
        accounts: accounts.value,
        resumeIds: [row.original.resumeId],
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
        <Button
          variant="outline"
          :disabled="syncMutation.isLoading.value || accounts.length === 0"
          @click="syncMutation.mutate()"
        >
          {{ syncMutation.isLoading.value ? "Синхронизирую…" : "Синхронизировать с hh" }}
        </Button>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <p v-if="syncMessage" class="mb-4 text-sm text-muted-foreground">{{ syncMessage }}</p>

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
  </section>
</template>
