<script setup lang="ts">
import { computed, h, onUnmounted, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { CrawlSchedule, ScheduleRun, SourceSyncKind } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { mailAccountApi, mailAccountKeys } from "@/entities/mail-account"
import { scheduleApi, scheduleKeys, type ScheduleUpsertInput } from "@/entities/schedule"
import { scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"
import { telegramAccountApi, telegramAccountKeys } from "@/entities/telegram-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, scheduleKindLabel } from "@/shared/lib"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => scheduleKeys.list(),
  query: () => scheduleApi.list()
})

const mailAccountsQuery = useQuery({
  key: () => mailAccountKeys.list(),
  query: () => mailAccountApi.list()
})

const telegramAccountsQuery = useQuery({
  key: () => telegramAccountKeys.list(),
  query: () => telegramAccountApi.list()
})

const schedules = computed<ReadonlyArray<CrawlSchedule>>(() =>
  (query.data.value ?? []).filter((schedule) =>
    schedule.kind !== "search" &&
    schedule.kind !== "vacancy_hydration" &&
    schedule.kind !== "employer_hydration"
  )
)

const runsQuery = useQuery({
  key: () => scheduleRunKeys.list(),
  query: () => scheduleRunApi.list({ limit: 50 })
})
const runs = computed<ReadonlyArray<ScheduleRun>>(() =>
  (runsQuery.data.value as { items?: ReadonlyArray<ScheduleRun> } | undefined)?.items ?? []
)
const runsPending = computed(
  () => (runsQuery as { isPending?: { value: boolean } }).isPending?.value ?? false
)
const runsLoading = computed(
  () => (runsQuery as { isLoading?: { value: boolean } }).isLoading?.value ?? false
)
const refreshRuns = () => (runsQuery as { refetch?: () => void }).refetch?.()
const mailAccounts = computed(() => mailAccountsQuery.data.value ?? [])
const telegramAccounts = computed(() => telegramAccountsQuery.data.value ?? [])

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

const kind = ref("mail_sync")
const target = ref("")
const interval = ref("30")
const enabled = ref(true)

const mailDays = ref("")
const mailLimit = ref("")
const mailMaxPages = ref("")
const dialogs = ref("")
const messages = ref("")

const editingId = ref<string | null>(null)
const formError = ref<string | null>(null)
const actionError = ref<string | null>(null)
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

const hasOptions = computed(
  () => kind.value === "mail_sync" || kind.value === "telegram_sync"
)
const isAccountTarget = computed(
  () => kind.value === "mail_sync" || kind.value === "telegram_sync"
)
const isChat = computed(() => kind.value === "hh_chat_sync")

const targetAccounts = computed(() =>
  kind.value === "mail_sync" ? mailAccounts.value : telegramAccounts.value
)

const selectedMailAccount = computed(() =>
  mailAccounts.value.find((account) => account.id === target.value)
)

const optionString = (options: Record<string, unknown>, key: string): string => {
  const value = options[key]
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

const defaultTarget = (next: string): string =>
  next === "hh_chat_sync" ? "global" : ""

const changeKind = (next: string) => {
  kind.value = next
  target.value = defaultTarget(next)
  formError.value = null
}

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
  kind.value = "mail_sync"
  target.value = ""
  interval.value = "30"
  enabled.value = true
  mailDays.value = ""
  mailLimit.value = ""
  mailMaxPages.value = ""
  dialogs.value = ""
  messages.value = ""
  formError.value = null
}

const fillForm = (schedule: CrawlSchedule) => {
  editingId.value = schedule.id
  const nextKind = schedule.kind === "source" ? "search" : schedule.kind
  kind.value = nextKind
  target.value = schedule.targetId
  interval.value = String(schedule.intervalMinutes)
  enabled.value = schedule.enabled
  mailLimit.value = nextKind === "mail_sync" ? optionString(schedule.options, "limit") : ""
  mailDays.value = nextKind === "mail_sync" ? optionString(schedule.options, "days") : ""
  mailMaxPages.value = nextKind === "mail_sync" ? optionString(schedule.options, "maxPages") : ""
  dialogs.value = nextKind === "telegram_sync" ? optionString(schedule.options, "dialogs") : ""
  messages.value = nextKind === "telegram_sync" ? optionString(schedule.options, "messages") : ""
  formError.value = null
  confirmDeleteId.value = null
}

const collectOptions = (): Record<string, unknown> | null => {
  const options: Record<string, unknown> = {}

  const add = (
    key: string,
    raw: string,
    title: string,
    minimum: number,
    maximum: number
  ): boolean => {
    if (raw.trim() === "") return true
    const value = Number(raw)
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      formError.value = `${title}: целое число от ${minimum} до ${maximum}.`
      return false
    }
    options[key] = value
    return true
  }

  let valid = true
  if (kind.value === "mail_sync") {
    valid = add("days", mailDays.value, "Дней", 0, 3_650) && valid
    valid = add("limit", mailLimit.value, "Лимит писем", 1, 500) && valid
    valid = add("maxPages", mailMaxPages.value, "Страниц", 1, 100) && valid
  } else if (kind.value === "telegram_sync") {
    valid = add("dialogs", dialogs.value, "Диалогов", 1, 100) && valid
    valid = add("messages", messages.value, "Сообщений", 1, 200) && valid
  }

  return valid ? options : null
}

const submit = async () => {
  actionError.value = null
  notice.value = null

  if (isChat.value) {
    formError.value = "Планирование чатов hh пока недоступно: нужен browser harness."
    return
  }

  const trimmedTarget = target.value.trim()
  if (isAccountTarget.value && trimmedTarget === "") {
    formError.value =
      kind.value === "mail_sync"
        ? "Выберите почтовый аккаунт."
        : "Выберите Telegram-аккаунт."
    return
  }

  const minutes = Number(interval.value)
  if (!Number.isInteger(minutes) || minutes < 5) {
    formError.value = "Интервал должен быть целым числом не меньше 5 минут."
    return
  }

  const options = collectOptions()
  if (options === null) return

  formError.value = null
  const wasEditing = editingId.value !== null

  try {
    await upsertMutation.mutateAsync({
      ...(editingId.value === null ? {} : { id: editingId.value }),
      kind: kind.value as SourceSyncKind,
      targetId: trimmedTarget,
      intervalMinutes: minutes,
      enabled: enabled.value,
      ...(Object.keys(options).length === 0 ? {} : { options })
    })
    resetForm()
    noticeTone.value = "info"
    notice.value = wasEditing ? "Обход обновлён." : "Обход создан."
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
    if (editingId.value === schedule.id) resetForm()
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Обход удалён." : "Обход не удалён: запись не найдена."
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
      ? "Запуск принят: обход идёт в фоне."
      : "Запуск не принят: обход не поставлен в очередь."
    if (result.accepted) scheduleRefresh()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    runningId.value = null
  }
}

const kindVariant = (value: string): "info" | "secondary" | "neutral" | "warning" => {
  switch (value) {
    case "source":
      return "info"
    case "hh_chat_sync":
      return "warning"
    default:
      return "info"
  }
}

const targetText = (schedule: CrawlSchedule): string => {
  switch (schedule.kind) {
    case "mail_sync": {
      const account = mailAccounts.value.find((item) => item.id === schedule.targetId)
      return account?.label ?? schedule.targetId
    }
    case "telegram_sync": {
      const account = telegramAccounts.value.find((item) => item.id === schedule.targetId)
      return account?.label ?? schedule.targetId
    }
    case "hh_chat_sync":
      return "Пока недоступно"
    default:
      return schedule.targetId
  }
}

const columns: ColumnDef<CrawlSchedule>[] = [
  {
    accessorKey: "kind",
    header: sortableHeader<CrawlSchedule>("Вид"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: kindVariant(row.original.kind) },
        () => scheduleKindLabel(row.original.kind)
      )
  },
  {
    id: "target",
    accessorFn: (row) => targetText(row),
    header: sortableHeader<CrawlSchedule>("Цель"),
    cell: ({ row }) => {
      const schedule = row.original
      const label = targetText(schedule)
      const isUrl = /^https?:\/\//i.test(schedule.targetId)
      return h("div", { class: "max-w-[360px]" }, [
        isUrl
          ? h(
              "a",
              {
                href: schedule.targetId,
                target: "_blank",
                rel: "noreferrer",
                class: "break-all text-sm text-sky-300 underline-offset-4 hover:underline"
              },
              label
            )
          : h("span", { class: "text-sm" }, label),
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
const runColumns: ColumnDef<ScheduleRun>[] = [
  {
    id: "schedule",
    accessorFn: (row) => row.scheduleId,
    header: sortableHeader<ScheduleRun>("Расписание"),
    cell: ({ row }) => h("code", { class: "font-mono text-xs" }, row.original.scheduleId)
  },
  {
    id: "kind",
    accessorFn: (row) => row.kind,
    header: sortableHeader<ScheduleRun>("Вид"),
    cell: ({ row }) => h("span", null, row.original.kind)
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    header: sortableHeader<ScheduleRun>("Статус"),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.status === "done" ? "success" : "secondary" }, () =>
        row.original.status
      )
  },
  {
    id: "detail",
    accessorFn: (row) => JSON.stringify(row.detail ?? {}),
    header: "Результат",
    cell: ({ row }) => {
      const detail = row.original.detail
      if (detail === null || detail === undefined) return h("span", { class: "text-muted-foreground" }, "—")
      return h("span", { class: "text-xs" }, JSON.stringify(detail))
    }
  },
  {
    id: "error",
    accessorFn: (row) => row.error ?? "",
    header: "Ошибка",
    cell: ({ row }) =>
      row.original.error
        ? h("span", { class: "text-xs text-destructive" }, row.original.error)
        : h("span", { class: "text-muted-foreground" }, "—")
  },
  {
    id: "startedAt",
    accessorFn: (row) => row.startedAt,
    header: sortableHeader<ScheduleRun>("Запущен"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.startedAt))
  },
  {
    id: "finishedAt",
    accessorFn: (row) => row.finishedAt ?? "",
    header: sortableHeader<ScheduleRun>("Завершён"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.finishedAt))
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Обход"
      description="Расписания синхронизации почты и Telegram. Гидратация вакансий и компаний вынесена на страницу «Гидратация», поиск — на страницу «Поиск». Запустите «Запустить» или дождитесь интервала."
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
        <CardTitle>{{ isEditing ? "Изменить обход" : "Новый обход" }}</CardTitle>
        <CardDescription>
          Один запланированный запуск выполняет одну ограниченную операцию выбранного вида.
          «Запустить» только принимает запрос: работа идёт в фоне.
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
            <div class="space-y-2">
              <Label for="schedule-kind">Вид обхода</Label>
              <Select :model-value="kind" @update:model-value="(value) => changeKind(String(value))">
                <SelectTrigger id="schedule-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  
                  <SelectItem value="mail_sync">Синхронизация почты</SelectItem>
                  <SelectItem value="telegram_sync">Синхронизация Telegram</SelectItem>
                  <SelectItem value="hh_chat_sync">Чаты hh (пока недоступно)</SelectItem>
                </SelectContent>
              </Select>
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

            <div v-if="isAccountTarget" class="space-y-2 md:col-span-2">
              <Label for="schedule-account">
                {{ kind === "mail_sync" ? "Почтовый аккаунт" : "Telegram-аккаунт" }}
              </Label>
              <Select
                v-if="targetAccounts.length > 0"
                :model-value="target"
                @update:model-value="(value) => (target = String(value))"
              >
                <SelectTrigger id="schedule-account">
                  <SelectValue placeholder="Выберите аккаунт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="account in targetAccounts"
                    :key="account.id"
                    :value="account.id"
                  >
                    {{ account.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div
                v-else
                class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
              >
                Нет доступных аккаунтов.
                <a
                  :href="kind === 'mail_sync' ? '/mail' : '/telegram'"
                  class="underline underline-offset-4"
                >
                  Добавьте аккаунт
                </a>
                , затем вернитесь сюда.
              </div>
              <p v-if="selectedMailAccount" class="text-xs text-muted-foreground">
                Глубина чтения: {{ selectedMailAccount.backfillDays }} дн. — задаётся в настройках
                почтового аккаунта.
              </p>
            </div>

            <div v-else-if="isChat" class="space-y-2 md:col-span-2">
              <Label for="schedule-chat-target">Цель</Label>
              <Input
                id="schedule-chat-target"
                model-value="Пока недоступно"
                disabled
              />
              <p class="text-xs text-muted-foreground">
                Чаты hh требуют browser harness. Планирование появится после его подключения.
              </p>
            </div>
          </div>

          <div v-if="hasOptions" class="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <template v-if="kind === 'mail_sync'">
              <div class="space-y-2">
                <Label for="schedule-mail-days">Дней</Label>
                <Input
                  id="schedule-mail-days"
                  v-model="mailDays"
                  type="number"
                  min="0"
                  max="3650"
                  step="1"
                  :placeholder="selectedMailAccount ? String(selectedMailAccount.backfillDays) : '30'"
                  :disabled="isSaving"
                />
                <p class="text-xs text-muted-foreground">
                  Глубина истории; по умолчанию берётся из аккаунта почты.
                </p>
              </div>
              <div class="space-y-2">
                <Label for="schedule-mail-limit">Лимит писем на страницу</Label>
                <Input
                  id="schedule-mail-limit"
                  v-model="mailLimit"
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  placeholder="100"
                  :disabled="isSaving"
                />
              </div>
              <div class="space-y-2">
                <Label for="schedule-mail-pages">Страниц за запуск</Label>
                <Input
                  id="schedule-mail-pages"
                  v-model="mailMaxPages"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="10"
                  :disabled="isSaving"
                />
              </div>
            </template>

            <template v-else-if="kind === 'telegram_sync'">
              <div class="space-y-2">
                <Label for="schedule-dialogs">Диалогов за запуск</Label>
                <Input
                  id="schedule-dialogs"
                  v-model="dialogs"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="25"
                  :disabled="isSaving"
                />
              </div>
              <div class="space-y-2">
                <Label for="schedule-messages">Сообщений на диалог</Label>
                <Input
                  id="schedule-messages"
                  v-model="messages"
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  placeholder="50"
                  :disabled="isSaving"
                />
              </div>
            </template>

            <template v-else-if="kind === 'hh_chat_sync'">
              <p class="text-xs text-muted-foreground md:col-span-2">
                Настройки чатов hh появятся вместе с browser harness.
              </p>
            </template>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="isSaving || isChat">
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
            <Label class="flex items-center gap-2 font-normal">
              <input
                v-model="enabled"
                type="checkbox"
                class="size-4 rounded border-input accent-primary"
                :disabled="isSaving || isChat"
              />
              Обход включён
            </Label>
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
      filter-placeholder="Вид, цель, состояние или ошибка"
      empty-title="Расписаний нет"
      empty-description="Создайте обход в форме выше, чтобы worker запускал поиск или синхронизацию по расписанию."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Обходов: {{ schedules.length }}</span>
      </template>
    </DataTable>

    <Card class="mt-6">
      <CardHeader>
        <CardTitle>История прогонов</CardTitle>
        <CardDescription>
          Результаты последних запусков расписаний: статус, ошибка и возвращённые данные.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          :columns="runColumns"
          :data="runs"
          :is-loading="runsPending"
          :loading-row-count="6"
          filter
          filter-label="Поиск"
          filter-placeholder="Вид, статус или ошибка"
          empty-title="Прогонов пока нет"
          empty-description="Запустите обход кнопкой «Запустить», чтобы здесь появился результат."
        >
          <template #toolbar>
            <RefreshButton :loading="runsLoading" @refresh="refreshRuns" />
            <span class="pb-2 text-xs text-muted-foreground">Прогонов: {{ runs.length }}</span>
          </template>
        </DataTable>
      </CardContent>
    </Card>
  </section>
</template>
