<script setup lang="ts">
import { computed, h } from "vue"
import { useQuery } from "@pinia/colada"
import type { AutoApplyCandidate, AutoMode } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Play } from "@lucide/vue"
import { autoApplyApi, autoApplyKeys } from "@/entities/auto-apply"
import { RUN_COUNT_LABELS, useAutoApplyRun } from "@/features/auto-apply-run"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatAge, formatDate, formatSalary, vacancyPath } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  HelpHint,
  sortableHeader
} from "@/shared/ui"
import { autoApplyHelp } from "../model/help"

/** Следующий запуск: когда он будет, что возьмёт, и единственная кнопка «Запустить сейчас». */
const props = defineProps<{
  accountId: string
  resumeId: string | null
  storedMode: AutoMode
  /** В форме есть несохранённые правки: отбор считается по сохранённым настройкам. */
  dirty: boolean
}>()

const query = useQuery({
  key: () => autoApplyKeys.preview(props.accountId, props.resumeId),
  query: () => autoApplyApi.preview({ hhAccountId: props.accountId, resumeId: props.resumeId }),
  enabled: () => props.accountId !== ""
})
const data = computed(() => query.data.value ?? null)
const settings = computed(() => data.value?.settings ?? null)

const { applySchedule, run, runState, runCounts, runError, running } = useAutoApplyRun({
  accountId: () => props.accountId,
  scheduleEnabled: () => props.storedMode !== "off"
})

const runDisabled = computed(
  () => running.value || runState.value === "waiting" || props.accountId === "" || props.storedMode === "off"
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
    cell: ({ row }) => row.original.resumeTitle ?? h("span", { class: "text-danger" }, "не выбрано")
  },
  {
    id: "fit",
    accessorFn: (row) => row.fit,
    header: sortableHeader<AutoApplyCandidate>("Соответствие", "right"),
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

/** Почему партия короче настроенной, если это так. */
const shortNote = computed(() => {
  const value = data.value
  if (value === null || value.willTake.length === 0 || value.willTake.length >= value.settings.batchSize) return null
  if (value.budget.remaining < value.settings.batchSize)
    return `В партии ${value.willTake.length} из ${value.settings.batchSize}: до дневного лимита осталось ${value.budget.remaining}.`
  return `В партии ${value.willTake.length} из ${value.settings.batchSize}: подходящих вакансий меньше размера партии.`
})

/** Почему нечего брать, если это так. */
const emptyReason = computed(() => {
  const value = data.value
  if (value === null || value.willTake.length > 0) return null
  if (value.budget.remaining <= 0) return "Дневной лимит исчерпан: отправлять больше нельзя, пока он не освободится."
  if (value.totalCandidates === 0 && value.excluded.belowMinPriority > 0)
    return "Все подходящие вакансии ниже минимального приоритета."
  if (value.totalCandidates === 0) return "Нет подходящих вакансий: на все уже есть отклик или решения «откликаться» нет."
  return "Нечего взять."
})

const error = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
</script>

<template>
  <Card>
    <CardContent class="space-y-4 p-4">
      <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div class="min-w-0 flex-1 space-y-1">
          <p class="text-sm">
            <template v-if="applySchedule === null">
              Расписания автооткликов ещё нет: оно создастся, когда вы сохраните режим «Черновики» или «Авто».
            </template>
            <template v-else-if="!applySchedule.enabled">
              <Badge variant="warning" class="mr-1">Расписание на паузе</Badge>
              Автоотклики сами не запустятся, пока расписание не включено.
            </template>
            <template v-else>
              Следующий запуск: <b>{{ formatDate(applySchedule.nextRunAt) }}</b>
              <span class="text-muted-foreground"> · каждые {{ applySchedule.intervalMinutes }} мин</span>
            </template>
            <a href="/schedules" class="ml-1 text-xs text-muted-foreground underline">Расписания</a>
          </p>
          <p v-if="storedMode === 'off'" class="text-xs text-muted-foreground">
            В режиме «Выключено» запуск ничего не создаёт, ниже только то, что было бы взято.
          </p>
          <p v-if="dirty" class="text-xs text-muted-foreground">
            Отбор считается по сохранённым настройкам; несохранённые правки в него не входят.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            :disabled="runDisabled"
            title="Запускает расписание автооткликов один раз, не дожидаясь интервала"
            @click="run"
          >
            <Play class="size-4" />
            {{ runState === "waiting" ? "Выполняется…" : "Запустить сейчас" }}
          </Button>
          <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
          <HelpHint :text="autoApplyHelp.preview" label="что возьмёт следующий запуск" />
        </div>
      </div>

      <Alert v-if="runError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Запуск</AlertTitle>
        <AlertDescription>{{ runError }}</AlertDescription>
      </Alert>
      <p v-if="runState === 'done'" class="text-sm" role="status">
        <template v-if="runCounts">
          <span v-for="[key, label] in RUN_COUNT_LABELS" :key="key" class="mr-3 inline-block">
            {{ label }}: <b>{{ runCounts[key] }}</b>
          </span>
        </template>
        <template v-else>Запуск завершён. Подробности на странице расписаний.</template>
      </p>

      <Alert v-if="error" variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить отбор</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <template v-if="data && settings">
        <p class="text-sm text-muted-foreground">
          Подходит всего <b class="text-foreground tabular-nums">{{ data.totalCandidates }}</b> · уже с откликом
          <b class="text-foreground tabular-nums">{{ data.excluded.alreadyApplied }}</b> · ниже порога приоритета
          <b class="text-foreground tabular-nums">{{ data.excluded.belowMinPriority }}</b>
        </p>
        <p v-if="data.fallbackResume" class="text-xs text-muted-foreground">
          Откликаемся резюме «{{ data.fallbackResume.title }}». Другие резюме аккаунта:
          {{ data.fallbackResume.others.join(", ") }}.
        </p>
        <p v-if="shortNote" class="text-xs text-muted-foreground">{{ shortNote }}</p>
      </template>

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

      <details v-if="next.length > 0" class="group space-y-2">
        <summary class="flex cursor-pointer items-center gap-1 text-sm font-semibold">
          Дальше по очереди ({{ next.length }})
          <HelpHint :text="autoApplyHelp.next" label="дальше по очереди" />
        </summary>
        <div class="pt-2"><DataTable :columns="columns" :data="next" :row-numbers="false" /></div>
      </details>
    </CardContent>
  </Card>
</template>
