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

const schedules = computed<ReadonlyArray<CrawlSchedule>>(() =>
  (query.data.value ?? []).filter((schedule) => schedule.kind === "search")
)

const queryCache = useQueryCache()

const upsertMutation = useMutation<CrawlSchedule, ScheduleUpsertInput>({
  mutation: (input) => scheduleApi.upsert(input)
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => scheduleApi.remove(id)
})

const runNowMutation = useMutation<{ readonly accepted: boolean }, string>({
  mutation: (id) => scheduleApi.runNow(id)
})

const target = ref("")
const interval = ref("30")
const enabled = ref(true)

const formError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const confirmDeleteId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const runningId = ref<string | null>(null)

const isSaving = computed(() => upsertMutation.isLoading.value)
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

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
  target.value = ""
  interval.value = "30"
  enabled.value = true
  formError.value = null
}

const submit = async () => {
  actionError.value = null
  notice.value = null

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
  try {
    await upsertMutation.mutateAsync({
      kind: "search",
      targetId: trimmedTarget,
      intervalMinutes: minutes,
      enabled: enabled.value
    })
    resetForm()
    noticeTone.value = "info"
    notice.value = "Поиск создан."
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const remove = async (schedule: CrawlSchedule) => {
  actionError.value = null
  notice.value = null
  removingId.value = schedule.id
  try {
    const result = await removeMutation.mutateAsync(schedule.id)
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Поиск удалён." : "Поиск не удалён: запись не найдена."
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    removingId.value = null
  }
}

const runNow = async (schedule: CrawlSchedule) => {
  actionError.value = null
  notice.value = null
  runningId.value = schedule.id
  try {
    const result = await runNowMutation.mutateAsync(schedule.id)
    noticeTone.value = result.accepted ? "info" : "warning"
    notice.value = result.accepted
      ? "Запуск принят: поиск идёт в фоне."
      : "Запуск не принят: поиск не поставлен в очередь."
    if (result.accepted) scheduleRefresh()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    runningId.value = null
  }
}

const columns: ColumnDef<CrawlSchedule>[] = [
  {
    id: "target",
    accessorFn: (row) => row.targetId,
    header: sortableHeader<CrawlSchedule>("Цель"),
    cell: ({ row }) => {
      const schedule = row.original
      return h("div", { class: "max-w-[360px]" }, [
        h(
          "a",
          {
            href: schedule.targetId,
            target: "_blank",
            rel: "noreferrer",
            class: "break-all text-sm text-sky-300 underline-offset-4 hover:underline"
          },
          schedule.targetId
        ),
        h("code", { class: "block text-[11px] text-muted-foreground" }, schedule.id)
      ])
    }
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
      title="Поиск"
      description="Поиск новых вакансий на hh.ru: расписание обходит страницу поиска по указанному URL и сохраняет найденные вакансии в корпус."
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

    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось выполнить действие</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" :variant="noticeTone" class="mb-4">
      <CircleAlert />
      <AlertTitle>{{ noticeTone === "warning" ? "Обратите внимание" : "Готово" }}</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>Новый поиск</CardTitle>
        <CardDescription>
          Вставьте ссылку на выдачу hh.ru. Расписание живёт дольше одного запуска и регулярно
          собирает новые вакансии в корпус.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="submit">
          <Alert v-if="formError" variant="destructive">
            <CircleAlert />
            <AlertTitle>Проверьте форму</AlertTitle>
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2 md:col-span-2">
              <Label for="search-target">URL поиска hh.ru</Label>
              <Input
                id="search-target"
                v-model="target"
                type="url"
                placeholder="https://hh.ru/search/vacancy?text=devops&area=1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                Ссылка на выдачу hh.ru, например https://hh.ru/search/vacancy?text=devops&area=1.
              </p>
            </div>

            <div class="space-y-2">
              <Label for="search-interval">Интервал, минуты</Label>
              <Input
                id="search-interval"
                v-model="interval"
                type="number"
                min="5"
                step="1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">Не меньше 5 минут.</p>
            </div>

            <div class="flex items-end">
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="enabled"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                Поиск включён
              </Label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="isSaving">
              Создать поиск
            </Button>
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
      empty-title="Поисков нет"
      empty-description="Вставьте ссылку на выдачу hh.ru в форму выше, чтобы worker регулярно собирал новые вакансии в корпус."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Поисков: {{ schedules.length }}</span>
      </template>
    </DataTable>
  </section>
</template>