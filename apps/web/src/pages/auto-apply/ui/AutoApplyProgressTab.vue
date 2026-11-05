<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { AutoApplyProgressItem, AutoApplyStage } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Copy } from "@lucide/vue"
import { autoApplyApi, autoApplyKeys, autoApplyStageMeta, autoApplyStages, autoRunLabel } from "@/entities/auto-apply"
import { RefreshButton } from "@/features/refresh-button"
import { applicationPath, describeError, formatAge, vacancyPath } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  HelpHint,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  sortableHeader
} from "@/shared/ui"
import { autoApplyHelp } from "../model/help"

const props = defineProps<{ accountId: string; visible: boolean }>()

const REFRESH_MS = 5000

const activeOnly = ref(false)
const stageFilter = ref<AutoApplyStage | null>(null)

const query = useQuery({
  key: () => autoApplyKeys.progress(props.accountId, activeOnly.value),
  query: () =>
    autoApplyApi.progress({
      hhAccountId: props.accountId === "" ? undefined : props.accountId,
      limit: 200,
      activeOnly: activeOnly.value
    }),
  enabled: () => props.accountId !== ""
})

const items = computed(() => query.data.value?.items ?? [])
const summary = computed(() => query.data.value?.summary ?? null)
const filtered = computed(() =>
  stageFilter.value === null ? items.value : items.value.filter((item) => item.stage === stageFilter.value)
)
const hasActive = computed(() =>
  items.value.some((item) => autoApplyStageMeta(item.stage).active) ||
  (summary.value !== null && autoApplyStages.some((stage) => stage.active && summary.value![stage.value] > 0))
)

/* Refresh every 5 s while the tab is shown, the document is visible and something is moving. */
const documentVisible = ref(document.visibilityState === "visible")
const onVisibility = () => {
  documentVisible.value = document.visibilityState === "visible"
  if (documentVisible.value && props.visible) void query.refetch()
}
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility)
  timer = setInterval(() => {
    if (props.visible && documentVisible.value && hasActive.value && !query.isLoading.value) void query.refetch()
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility)
  if (timer !== null) clearInterval(timer)
  timer = null
})

const ageOf = (value: string): string => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? "—" : `${formatAge((Date.now() - time) / 1000)} назад`
}

const selected = ref<AutoApplyProgressItem | null>(null)
const sheetOpen = computed({
  get: () => selected.value !== null,
  set: (value: boolean) => {
    if (!value) selected.value = null
  }
})
const copied = ref(false)
const copyLetter = async () => {
  if (selected.value?.letter == null) return
  try {
    await navigator.clipboard.writeText(selected.value.letter)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // Clipboard may be unavailable; the text stays selectable.
  }
}

const columns: ColumnDef<AutoApplyProgressItem>[] = [
  {
    id: "stage",
    accessorFn: (row) => autoApplyStages.findIndex((stage) => stage.value === row.stage),
    header: sortableHeader<AutoApplyProgressItem>("Этап", "left", autoApplyHelp.stages),
    cell: ({ row }) => {
      const meta = autoApplyStageMeta(row.original.stage)
      return h(Badge, { variant: meta.tone }, () => meta.label)
    }
  },
  {
    id: "vacancy",
    accessorFn: (row) => row.title,
    header: sortableHeader<AutoApplyProgressItem>("Вакансия"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[340px]" }, [
        h(
          "a",
          {
            href: vacancyPath(row.original.vacancyId),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          row.original.title
        ),
        row.original.employerName
          ? h("div", { class: "text-xs text-muted-foreground" }, row.original.employerName)
          : null
      ])
  },
  {
    id: "resume",
    accessorFn: (row) => row.resumeTitle ?? "",
    header: sortableHeader<AutoApplyProgressItem>("Резюме"),
    cell: ({ row }) => row.original.resumeTitle ?? "—"
  },
  {
    id: "mode",
    accessorFn: (row) => row.autoRun,
    header: sortableHeader<AutoApplyProgressItem>("Режим"),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.autoRun === "auto" ? "info" : "outline" }, () =>
        row.original.autoRun === "auto" ? "авто" : "черновик"
      )
  },
  {
    id: "detail",
    accessorFn: (row) => row.stageDetail,
    enableSorting: false,
    header: "Детали",
    cell: ({ row }) => h("span", { class: "text-sm" }, row.original.stageDetail)
  },
  {
    id: "attempts",
    accessorFn: (row) => row.writingJob?.attempts ?? 0,
    header: sortableHeader<AutoApplyProgressItem>("Письмо"),
    cell: ({ row }) => {
      const job = row.original.writingJob
      return job === null
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h("span", { class: "whitespace-nowrap tabular-nums" }, `${job.attempts}/${job.maxAttempts}`)
    }
  },
  {
    id: "updatedAt",
    accessorFn: (row) => Date.parse(row.updatedAt),
    header: sortableHeader<AutoApplyProgressItem>("Обновлён"),
    cell: ({ row }) => h("span", { class: "whitespace-nowrap text-muted-foreground" }, ageOf(row.original.updatedAt))
  },
  {
    id: "open",
    enableSorting: false,
    header: "",
    cell: ({ row }) =>
      h(
        Button,
        { size: "sm", variant: "ghost", onClick: () => (selected.value = row.original) },
        () => "Подробнее"
      )
  }
]

const error = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
</script>

<template>
  <div class="space-y-4">
    <Alert v-if="error" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить ход</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="stage in autoApplyStages"
        :key="stage.value"
        type="button"
        class="rounded-full"
        :aria-pressed="stageFilter === stage.value"
        @click="stageFilter = stageFilter === stage.value ? null : stage.value"
      >
        <Badge
          :variant="stage.tone"
          :class="stageFilter === stage.value ? 'ring-2 ring-ring' : 'opacity-90 hover:opacity-100'"
        >
          {{ stage.label }}: {{ summary ? summary[stage.value] : 0 }}
        </Badge>
      </button>
      <HelpHint :text="autoApplyHelp.stages" label="этапы" />
      <label class="ml-auto flex items-center gap-2 text-sm">
        <input v-model="activeOnly" type="checkbox" />
        Только активные
        <HelpHint :text="autoApplyHelp.active" label="только активные" />
      </label>
      <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
    </div>
    <p class="text-xs text-muted-foreground">
      Счётчики за последние 3 дня.
      <template v-if="hasActive">Обновляется каждые 5 секунд, пока вкладка открыта.</template>
    </p>

    <DataTable
      :columns="columns"
      :data="filtered"
      :is-loading="query.isPending.value"
      :row-numbers="false"
      empty-title="Откликов автоотбора нет"
      empty-description="Они появятся после запуска автоотбора в режиме «Черновики» или «Отправка»."
      :initial-sorting="[{ id: 'updatedAt', desc: true }]"
    />

    <Sheet v-model:open="sheetOpen">
      <SheetContent side="right" class="w-full overflow-y-auto p-4 sm:max-w-2xl">
        <template v-if="selected">
          <SheetHeader>
            <SheetTitle>{{ selected.title }}</SheetTitle>
            <SheetDescription>
              {{ selected.employerName ?? "Компания не указана" }} · {{ autoRunLabel(selected.autoRun) }} ·
              резюме: {{ selected.resumeTitle ?? "не выбрано" }}
            </SheetDescription>
          </SheetHeader>
          <div class="mt-4 space-y-4 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="autoApplyStageMeta(selected.stage).tone">
                {{ autoApplyStageMeta(selected.stage).label }}
              </Badge>
              <span class="text-muted-foreground">{{ selected.stageDetail }}</span>
            </div>
            <p v-if="selected.writingJob" class="text-xs text-muted-foreground">
              Письмо: задача {{ selected.writingJob.status }}, попытка {{ selected.writingJob.attempts }} из
              {{ selected.writingJob.maxAttempts }}
              <template v-if="selected.writingJob.error">· {{ selected.writingJob.error }}</template>
            </p>
            <p v-if="selected.formReadStatus" class="text-xs text-muted-foreground">
              Чтение формы: {{ selected.formReadStatus }}
            </p>
            <p class="text-xs text-muted-foreground">Ответов на вопросы формы: {{ selected.answersCount }}</p>
            <Alert v-if="selected.lastError" variant="destructive">
              <CircleAlert />
              <AlertTitle>Последняя ошибка</AlertTitle>
              <AlertDescription>{{ selected.lastError }}</AlertDescription>
            </Alert>
            <div>
              <div class="mb-1 flex items-center justify-between">
                <h3 class="text-sm font-semibold">Письмо</h3>
                <Button v-if="selected.letter" size="sm" variant="outline" @click="copyLetter">
                  <Copy class="h-4 w-4" />
                  {{ copied ? "Скопировано" : "Копировать" }}
                </Button>
              </div>
              <pre
                v-if="selected.letter"
                class="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm"
              >{{ selected.letter }}</pre>
              <p v-else class="text-xs text-muted-foreground">Письма пока нет.</p>
            </div>
            <div class="flex gap-3 text-xs">
              <a :href="applicationPath(selected.applicationId)" class="underline">Страница отклика</a>
              <a :href="vacancyPath(selected.vacancyId)" class="underline">Вакансия</a>
            </div>
          </div>
        </template>
      </SheetContent>
    </Sheet>
  </div>
</template>
