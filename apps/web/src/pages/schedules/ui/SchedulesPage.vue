<script setup lang="ts">
import { computed, h, onUnmounted, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { CrawlSchedule } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { scheduleApi, scheduleKeys, type ScheduleUpsertInput } from "@/entities/schedule"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Input,
  Label,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => scheduleKeys.list(),
  query: () => scheduleApi.list()
})

const schedules = computed<ReadonlyArray<CrawlSchedule>>(() => query.data.value ?? [])

const queryCache = useQueryCache()

const upsertMutation = useMutation<CrawlSchedule, ScheduleUpsertInput>({
  mutation: (input) => scheduleApi.upsert(input),
  async onSuccess() {
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  }
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => scheduleApi.remove(id),
  async onSuccess() {
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  }
})

const runNowMutation = useMutation<{ readonly accepted: boolean }, string>({
  mutation: (id) => scheduleApi.runNow(id)
})

const editingId = ref<string | null>(null)
const target = ref("")
const interval = ref("30")
const enabled = ref(true)
const formError = ref<string | null>(null)
const notice = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const confirmDeleteId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const runningId = ref<string | null>(null)

const isEditing = computed(() => editingId.value !== null)
const isSaving = computed(() => upsertMutation.isLoading.value)
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
const writeErrorText = computed(() => {
  const failure =
    upsertMutation.error.value ?? removeMutation.error.value ?? runNowMutation.error.value
  return failure === null ? null : describeError(failure)
})

/** One delayed refetch after "run now"; the crawl itself is detached. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const scheduleRefresh = () => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void query.refetch()
  }, 1_500)
}

onUnmounted(() => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
})

const resetForm = () => {
  editingId.value = null
  target.value = ""
  interval.value = "30"
  enabled.value = true
  formError.value = null
}

const fillForm = (schedule: CrawlSchedule) => {
  editingId.value = schedule.id
  target.value = schedule.targetId
  interval.value = String(schedule.intervalMinutes)
  enabled.value = schedule.enabled
  formError.value = null
  confirmDeleteId.value = null
}

const submit = async () => {
  const trimmedTarget = target.value.trim()
  if (trimmedTarget === "") {
    formError.value = "Введите URL поиска hh.ru."
    return
  }
  if (!/^https?:\/\//i.test(trimmedTarget)) {
    formError.value = "URL должен начинаться с http:// или https://."
    return
  }

  const minutes = Number(interval.value)
  if (!Number.isInteger(minutes) || minutes < 5) {
    formError.value = "Интервал должен быть целым числом не меньше 5 минут."
    return
  }

  formError.value = null
  notice.value = null
  const wasEditing = editingId.value !== null

  try {
    await upsertMutation.mutateAsync({
      id: editingId.value ?? undefined,
      targetId: trimmedTarget,
      intervalMinutes: minutes,
      enabled: enabled.value
    })
    resetForm()
    noticeTone.value = "info"
    notice.value = wasEditing ? "Обход обновлён." : "Обход создан."
  } catch {
    // The mutation error is rendered above the form.
  }
}

const remove = async (schedule: CrawlSchedule) => {
  notice.value = null
  removingId.value = schedule.id
  try {
    const result = await removeMutation.mutateAsync(schedule.id)
    if (editingId.value === schedule.id) resetForm()
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Обход удалён." : "Обход не удалён: запись не найдена."
  } catch {
    // The mutation error is rendered above the form.
  } finally {
    removingId.value = null
  }
}

const runNow = async (schedule: CrawlSchedule) => {
  notice.value = null
  runningId.value = schedule.id
  try {
    const result = await runNowMutation.mutateAsync(schedule.id)
    noticeTone.value = result.accepted ? "info" : "warning"
    notice.value = result.accepted
      ? "Запуск принят: обход идёт в фоне."
      : "Запуск не принят: обход не поставлен в очередь."
    if (result.accepted) scheduleRefresh()
  } catch {
    // The mutation error is rendered above the form.
  } finally {
    runningId.value = null
  }
}

const columns: ColumnDef<CrawlSchedule>[] = [
  {
    accessorKey: "targetId",
    header: sortableHeader<CrawlSchedule>("Цель (URL)"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[360px]" }, [
        h(
          "a",
          {
            href: row.original.targetId,
            target: "_blank",
            rel: "noreferrer",
            class: "break-all text-sm text-sky-300 underline-offset-4 hover:underline"
          },
          row.original.targetId
        ),
        h("code", { class: "block text-[11px] text-muted-foreground" }, row.original.id)
      ])
  },
  {
    accessorKey: "intervalMinutes",
    header: sortableHeader<CrawlSchedule>("Интервал"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap tabular-nums" },
        `${row.original.intervalMinutes} мин`
      )
  },
  {
    id: "enabled",
    accessorFn: (row) => (row.enabled ? "включён" : "выключен"),
    header: sortableHeader<CrawlSchedule>("Состояние"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.enabled ? "success" : "neutral" },
        () => (row.original.enabled ? "Включён" : "Выключен")
      )
  },
  {
    accessorKey: "lastRunAt",
    header: sortableHeader<CrawlSchedule>("Последний запуск"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.lastRunAt)
      )
  },
  {
    accessorKey: "nextRunAt",
    header: sortableHeader<CrawlSchedule>("Следующий запуск"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.nextRunAt)
      )
  },
  {
    id: "lastError",
    accessorFn: (row) => row.lastError ?? "",
    header: "Последняя ошибка",
    cell: ({ row }) => {
      const error = row.original.lastError
      if (error === null || error === "") {
        return h("span", { class: "text-muted-foreground" }, "—")
      }
      return h(
        "span",
        {
          class: "block max-w-[260px] truncate text-xs text-red-300",
          title: error
        },
        error
      )
    }
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) => {
      const schedule = row.original
      if (confirmDeleteId.value === schedule.id) {
        return h("div", { class: "flex items-center gap-1.5" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Удалить?"),
          h(
            Button,
            {
              size: "sm",
              variant: "destructive",
              disabled: removingId.value === schedule.id,
              onClick: () => void remove(schedule)
            },
            () => (removingId.value === schedule.id ? "Удаляем…" : "Да")
          ),
          h(
            Button,
            { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = null) },
            () => "Отмена"
          )
        ])
      }
      return h("div", { class: "flex flex-wrap items-center gap-1.5" }, [
        h(
          Button,
          { size: "sm", variant: "outline", onClick: () => fillForm(schedule) },
          () => "Изменить"
        ),
        h(
          Button,
          {
            size: "sm",
            variant: "secondary",
            disabled: runningId.value === schedule.id,
            onClick: () => void runNow(schedule)
          },
          () => (runningId.value === schedule.id ? "Запускаем…" : "Запустить")
        ),
        h(
          Button,
          { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = schedule.id) },
          () => "Удалить"
        )
      ])
    }
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Обход"
      description="Расписания обхода поиска hh.ru. Worker сам запускает те, чей срок наступил."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить расписания</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" :variant="noticeTone" class="mb-4">
      <CircleAlert />
      <AlertTitle>{{ noticeTone === "warning" ? "Обратите внимание" : "Готово" }}</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>{{ isEditing ? "Изменить обход" : "Новый обход" }}</CardTitle>
        <CardDescription>
          Worker запускает обходы по интервалу. Один запланированный запуск ограничен одной
          страницей поиска hh.ru.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="submit">
          <Alert v-if="formError" variant="destructive">
            <CircleAlert />
            <AlertTitle>Проверьте форму</AlertTitle>
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>

          <Alert v-if="writeErrorText" variant="destructive">
            <CircleAlert />
            <AlertTitle>Не удалось выполнить действие</AlertTitle>
            <AlertDescription>{{ writeErrorText }}</AlertDescription>
          </Alert>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2 md:col-span-2">
              <Label for="schedule-target">URL поиска</Label>
              <Input
                id="schedule-target"
                v-model="target"
                type="url"
                placeholder="https://hh.ru/search/vacancy?text=backend"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                Ссылка на выдачу hh.ru, а не id сохранённого поиска: расписание живёт дольше
                одного запуска.
              </p>
            </div>

            <div class="space-y-2">
              <Label for="schedule-interval">Интервал, минуты</Label>
              <Input
                id="schedule-interval"
                v-model="interval"
                type="number"
                min="5"
                step="1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">Не меньше 5 минут.</p>
            </div>

            <div class="flex items-end pb-1">
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="enabled"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                Обход включён
              </Label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="isSaving">
              {{ isEditing ? "Сохранить" : "Создать обход" }}
            </Button>
            <Button
              v-if="isEditing"
              type="button"
              variant="outline"
              :disabled="isSaving"
              @click="resetForm"
            >
              Отмена
            </Button>
            <span class="text-xs text-muted-foreground">
              «Запустить» только принимает запрос: сам обход идёт в фоне.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>

    <DataTable
      :columns="columns"
      :data="schedules"
      :is-loading="isListPending"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="URL, состояние или ошибка"
      empty-title="Расписаний нет"
      empty-description="Создайте обход в форме выше, чтобы worker запускал поиск по расписанию."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Обходов: {{ schedules.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
