<script setup lang="ts">
import { computed, h } from "vue"
import { useQuery } from "@pinia/colada"
import type { AutoApplyCandidate } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Play } from "@lucide/vue"
import { applySortOptions, autoModeOptions, sortDirectionOptions } from "@/entities/apply-filter"
import { autoApplyApi, autoApplyKeys } from "@/entities/auto-apply"
import { RUN_COUNT_LABELS, useAutoApplyRun } from "@/features/auto-apply-run"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatAge, formatSalary, vacancyPath } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  EmptyState,
  HelpHint,
  sortableHeader
} from "@/shared/ui"
import { StatCard } from "@/widgets/stat-card"
import { autoApplyHelp } from "../model/help"

const props = defineProps<{ accountId: string; resumeId: string | null }>()

const query = useQuery({
  key: () => autoApplyKeys.preview(props.accountId, props.resumeId),
  query: () => autoApplyApi.preview({ hhAccountId: props.accountId, resumeId: props.resumeId }),
  enabled: () => props.accountId !== ""
})
const data = computed(() => query.data.value ?? null)
const settings = computed(() => data.value?.settings ?? null)

const { run, runState, runCounts, runError, running } = useAutoApplyRun({
  accountId: () => props.accountId,
  scheduleEnabled: () => (settings.value?.autoMode ?? "off") !== "off"
})

const modeOption = computed(() => autoModeOptions.find((option) => option.value === settings.value?.autoMode))
const modeVariant = computed(() =>
  settings.value?.autoMode === "auto" ? "destructive" : settings.value?.autoMode === "drafts" ? "outline" : "secondary"
)
const sortLabel = computed(() => applySortOptions.find((option) => option.value === settings.value?.sort)?.label ?? "")
const directionLabel = computed(
  () => sortDirectionOptions.find((option) => option.value === settings.value?.sortDirection)?.label ?? ""
)

const ageOf = (publishedAt: string | null): string => {
  if (publishedAt === null) return "—"
  const time = Date.parse(publishedAt)
  return Number.isNaN(time) ? "—" : `${formatAge((Date.now() - time) / 1000)} назад`
}

const columns: ColumnDef<AutoApplyCandidate>[] = [
  {
    id: "rank",
    accessorFn: (row) => row.rank,
    header: sortableHeader<AutoApplyCandidate>("Место"),
    cell: ({ row }) => h("span", { class: "tabular-nums text-muted-foreground" }, String(row.original.rank))
  },
  {
    id: "title",
    accessorFn: (row) => row.title,
    header: sortableHeader<AutoApplyCandidate>("Вакансия"),
    cell: ({ row }) =>
      h(
        "a",
        {
          href: vacancyPath(row.original.vacancyId),
          class: "block max-w-[380px] font-medium text-foreground transition-colors hover:text-primary"
        },
        row.original.title
      )
  },
  {
    id: "employer",
    accessorFn: (row) => row.employerName ?? "",
    header: sortableHeader<AutoApplyCandidate>("Компания"),
    cell: ({ row }) => row.original.employerName ?? "—"
  },
  {
    id: "resume",
    accessorFn: (row) => row.resumeTitle ?? "",
    header: sortableHeader<AutoApplyCandidate>("Резюме"),
    cell: ({ row }) =>
      row.original.resumeTitle ??
      h("span", { class: "text-destructive" }, "не выбрано")
  },
  {
    id: "fit",
    accessorFn: (row) => row.fit,
    header: sortableHeader<AutoApplyCandidate>("Fit", "right"),
    cell: ({ row }) => h("div", { class: "text-right tabular-nums" }, String(Math.round(row.original.fit)))
  },
  {
    id: "priority",
    accessorFn: (row) => row.priority,
    header: sortableHeader<AutoApplyCandidate>("Приоритет", "right"),
    cell: ({ row }) => h("div", { class: "text-right tabular-nums" }, row.original.priority.toFixed(1))
  },
  {
    id: "publishedAt",
    accessorFn: (row) => (row.publishedAt === null ? 0 : Date.parse(row.publishedAt)),
    header: sortableHeader<AutoApplyCandidate>("Опубликована"),
    cell: ({ row }) => h("span", { class: "whitespace-nowrap text-muted-foreground" }, ageOf(row.original.publishedAt))
  },
  {
    id: "salary",
    accessorFn: (row) => row.salaryFrom ?? row.salaryTo ?? 0,
    header: sortableHeader<AutoApplyCandidate>("Зарплата"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap" },
        formatSalary(row.original.salaryFrom, row.original.salaryTo, row.original.salaryCurrency)
      )
  }
]

const willTake = computed(() => data.value?.willTake ?? [])
const next = computed(() => data.value?.next ?? [])

/** Why the batch is shorter than configured, when it is. */
const shortNote = computed(() => {
  const value = data.value
  if (value === null || value.willTake.length >= value.settings.batchSize) return null
  if (value.budget.remaining < value.settings.batchSize) {
    return `В партии ${value.willTake.length} из ${value.settings.batchSize}: до дневного лимита осталось ${value.budget.remaining}.`
  }
  return `В партии ${value.willTake.length} из ${value.settings.batchSize}: подходящих вакансий меньше размера партии.`
})

/** The reason nothing can be taken, when that is the case. */
const emptyReason = computed(() => {
  const value = data.value
  if (value === null || value.willTake.length > 0) return null
  if (value.budget.remaining <= 0) return "Дневной лимит исчерпан: отправлять больше нельзя, пока он не освободится."
  if (value.totalCandidates === 0 && value.excluded.belowMinPriority > 0)
    return "Все подходящие вакансии ниже минимального приоритета."
  if (value.totalCandidates === 0) return "Нет подходящих вакансий: все с откликом или решения «откликаться» нет."
  return "Нечего взять."
})

const error = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
</script>

<template>
  <div class="space-y-4">
    <Alert v-if="error" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отбор</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        :disabled="running || runState === 'waiting' || accountId === ''"
        title="Запускает расписание apply один раз, не дожидаясь интервала"
        @click="run"
      >
        <Play class="h-4 w-4" />
        {{ runState === "waiting" ? "Выполняется…" : "Запустить сейчас" }}
      </Button>
      <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      <HelpHint :text="autoApplyHelp.preview" label="что возьмёт следующий запуск" />
      <a href="/apply-filter" class="ml-auto text-xs text-muted-foreground underline">Фильтр откликов</a>
    </div>
    <Alert v-if="runError" variant="destructive">
      <CircleAlert />
      <AlertTitle>Запуск</AlertTitle>
      <AlertDescription>{{ runError }}</AlertDescription>
    </Alert>
    <p v-if="runState === 'done'" class="text-sm">
      <template v-if="runCounts">
        <span v-for="[key, label] in RUN_COUNT_LABELS" :key="key" class="mr-3">
          {{ label }}: <b>{{ runCounts[key] }}</b>
        </span>
      </template>
      <template v-else>Запуск завершён. Подробности на странице расписаний.</template>
    </p>

    <template v-if="data && settings">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Режим">
          <Badge :variant="modeVariant">{{ modeOption?.label }}</Badge>
          <template v-if="settings.autoMode === 'off'">
            <p class="mt-1 text-xs font-normal text-muted-foreground">
              Режим выключен — это то, что было бы взято
            </p>
          </template>
        </StatCard>
        <StatCard
          label="Бюджет"
          :value="`${data.budget.used} из ${data.budget.limit}`"
          :hint="`Сегодня отправлено ${data.budget.used} из ${data.budget.limit}, осталось ${data.budget.remaining}`"
        />
        <StatCard label="Сортировка" :value="sortLabel" :hint="directionLabel" />
        <StatCard label="Партия" :value="settings.batchSize" />
        <StatCard label="Мин. приоритет" :value="settings.minPriority" />
        <StatCard label="Всего подходит" :value="data.totalCandidates" />
      </div>
      <p class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        Всего подходит: {{ data.totalCandidates }}; уже с откликом: {{ data.excluded.alreadyApplied }}; ниже
        порога: {{ data.excluded.belowMinPriority }}.
        <HelpHint :text="autoApplyHelp.minPriority" label="мин. приоритет" />
        <HelpHint :text="autoApplyHelp.budget" label="бюджет" />
      </p>

      <p v-if="data.fallbackResume" class="text-xs text-muted-foreground">
        Откликаемся резюме «{{ data.fallbackResume.title }}». Другие резюме аккаунта:
        {{ data.fallbackResume.others.join(", ") }}.
      </p>

      <p v-if="shortNote && willTake.length > 0" class="text-xs text-muted-foreground">{{ shortNote }}</p>

      <DataTable
        :columns="columns"
        :data="willTake"
        :is-loading="query.isPending.value"
        :row-numbers="false"
        empty-title="Нечего взять"
      >
        <template #empty>
          <EmptyState title="Нечего взять" :description="emptyReason ?? undefined" />
        </template>
      </DataTable>

      <div v-if="next.length > 0" class="space-y-2">
        <div class="flex items-center gap-1">
          <h2 class="text-sm font-semibold">Дальше по очереди</h2>
          <HelpHint :text="autoApplyHelp.next" label="дальше по очереди" />
        </div>
        <DataTable :columns="columns" :data="next" :row-numbers="false" />
      </div>
    </template>
    <DataTable v-else :columns="columns" :data="[]" :is-loading="query.isPending.value" :row-numbers="false" />
  </div>
</template>
