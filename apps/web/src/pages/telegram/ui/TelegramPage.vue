<script setup lang="ts">
import { computed, h, onUnmounted, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type {
  SyncResult,
  TelegramAccountRecord,
  TelegramLoginStatusValue
} from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, QrCode, Send } from "@lucide/vue"
import QrcodeVue from "qrcode.vue"
import {
  telegramAccountApi,
  telegramAccountKeys,
  type TelegramAccountUpsertInput
} from "@/entities/telegram-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Input,
  Label,
  StatusBadge,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => telegramAccountKeys.list(),
  query: () => telegramAccountApi.list()
})

const accounts = computed<ReadonlyArray<TelegramAccountRecord>>(() => query.data.value ?? [])
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

const queryCache = useQueryCache()

const upsertMutation = useMutation<TelegramAccountRecord, TelegramAccountUpsertInput>({
  mutation: (input) => telegramAccountApi.upsert(input)
})

const syncMutation = useMutation<SyncResult, string>({
  mutation: (id) => telegramAccountApi.sync(id)
})

const qrMutation = useMutation<{ readonly qrUrl: string; readonly expiresAt: string }, string>({
  mutation: (id) => telegramAccountApi.loginQr(id)
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => telegramAccountApi.remove(id)
})

const label = ref("")
const apiId = ref("")
const apiHash = ref("")
const phone = ref("")

const formError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const syncResult = ref<SyncResult | null>(null)
const syncingId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const connectingId = ref<string | null>(null)

const qrAccount = ref<TelegramAccountRecord | null>(null)
const qrUrl = ref<string | null>(null)
const qrExpiresAt = ref<string | null>(null)
const loginStatus = ref<TelegramLoginStatusValue>("idle")
const loginError = ref<string | null>(null)

const isSaving = computed(() => upsertMutation.isLoading.value)
const isPolling = computed(
  () => loginStatus.value === "pending" && qrAccount.value !== null
)

let pollTimer: ReturnType<typeof setInterval> | null = null

const stopPolling = () => {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onUnmounted(stopPolling)

const resetForm = () => {
  label.value = ""
  apiId.value = ""
  apiHash.value = ""
  phone.value = ""
  formError.value = null
}

const submit = async () => {
  actionError.value = null
  notice.value = null
  syncResult.value = null

  const trimmedLabel = label.value.trim()
  if (trimmedLabel === "") {
    formError.value = "Введите название аккаунта."
    return
  }

  const appId = Number(apiId.value)
  if (!Number.isInteger(appId) || appId <= 0) {
    formError.value = "api_id должен быть положительным целым числом."
    return
  }

  if (apiHash.value.trim() === "") {
    formError.value = "Введите api_hash приложения Telegram."
    return
  }

  formError.value = null
  const trimmedPhone = phone.value.trim()

  try {
    await upsertMutation.mutateAsync({
      label: trimmedLabel,
      apiId: appId,
      apiHash: apiHash.value.trim(),
      ...(trimmedPhone === "" ? {} : { phone: trimmedPhone })
    })
    resetForm()
    noticeTone.value = "info"
    notice.value = "Аккаунт добавлен. Теперь подключите его по QR-коду."
    await queryCache.invalidateQueries({ key: telegramAccountKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const pollLogin = async (id: string) => {
  if (qrExpiresAt.value !== null && new Date(qrExpiresAt.value).getTime() < Date.now()) {
    stopPolling()
    loginStatus.value = "error"
    loginError.value = "QR-код истёк. Запустите подключение заново."
    return
  }

  try {
    const result = await telegramAccountApi.loginStatus(id)
    loginStatus.value = result.status
    loginError.value = result.error ?? null

    if (result.status === "authorized") {
      stopPolling()
      qrUrl.value = null
      noticeTone.value = "info"
      notice.value = "Telegram подключён. Аккаунт готов к синхронизации."
      await queryCache.invalidateQueries({ key: telegramAccountKeys.all })
      await query.refetch()
    } else if (result.status === "error") {
      stopPolling()
      await query.refetch()
    }
  } catch (error) {
    stopPolling()
    loginStatus.value = "error"
    loginError.value = describeError(error)
  }
}

const startPolling = (id: string) => {
  stopPolling()
  pollTimer = setInterval(() => {
    void pollLogin(id)
  }, 2_000)
}

const connectQr = async (account: TelegramAccountRecord) => {
  actionError.value = null
  notice.value = null
  syncResult.value = null
  stopPolling()
  qrAccount.value = account
  qrUrl.value = null
  qrExpiresAt.value = null
  loginStatus.value = "idle"
  loginError.value = null
  connectingId.value = account.id

  try {
    const result = await qrMutation.mutateAsync(account.id)
    qrUrl.value = result.qrUrl
    qrExpiresAt.value = result.expiresAt
    loginStatus.value = "pending"
    startPolling(account.id)
  } catch (error) {
    loginStatus.value = "error"
    loginError.value = describeError(error)
  } finally {
    connectingId.value = null
  }
}

const closeQr = () => {
  stopPolling()
  qrAccount.value = null
  qrUrl.value = null
  qrExpiresAt.value = null
  loginStatus.value = "idle"
  loginError.value = null
}

const syncNow = async (account: TelegramAccountRecord) => {
  actionError.value = null
  notice.value = null
  syncResult.value = null
  syncingId.value = account.id
  try {
    syncResult.value = await syncMutation.mutateAsync(account.id)
    await queryCache.invalidateQueries({ key: telegramAccountKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    syncingId.value = null
  }
}

const remove = async (account: TelegramAccountRecord) => {
  actionError.value = null
  notice.value = null
  removingId.value = account.id
  try {
    const result = await removeMutation.mutateAsync(account.id)
    if (qrAccount.value?.id === account.id) closeQr()
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Telegram-аккаунт удалён." : "Аккаунт не удалён: запись не найдена."
    await queryCache.invalidateQueries({ key: telegramAccountKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    removingId.value = null
  }
}

const columns: ColumnDef<TelegramAccountRecord>[] = [
  {
    id: "account",
    accessorFn: (row) => `${row.label} ${row.username ?? ""}`,
    header: sortableHeader<TelegramAccountRecord>("Аккаунт"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[260px]" }, [
        h("div", { class: "font-medium" }, row.original.label),
        h(
          "div",
          { class: "text-xs text-muted-foreground" },
          row.original.username === null ? "username не указан" : `@${row.original.username}`
        )
      ])
  },
  {
    id: "phone",
    accessorFn: (row) => row.phoneMasked ?? "",
    header: "Телефон",
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap font-mono text-xs" },
        row.original.phoneMasked ?? "—"
      )
  },
  {
    accessorKey: "status",
    header: sortableHeader<TelegramAccountRecord>("Статус"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.status, raw: true })
  },
  {
    accessorKey: "lastSyncAt",
    header: sortableHeader<TelegramAccountRecord>("Последняя синхронизация"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.lastSyncAt)
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
        { class: "block max-w-[240px] truncate text-xs text-red-700 dark:text-red-300", title: error },
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
      const account = row.original
      if (confirmDeleteId.value === account.id) {
        return h("div", { class: "flex items-center gap-1.5" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Удалить?"),
          h(
            Button,
            {
              size: "sm",
              variant: "destructive",
              disabled: removingId.value === account.id,
              onClick: () => void remove(account)
            },
            () => (removingId.value === account.id ? "Удаляем…" : "Да")
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
            variant: "outline",
            disabled: connectingId.value === account.id,
            onClick: () => void connectQr(account)
          },
          () => (connectingId.value === account.id ? "Готовим QR…" : "Подключить по QR")
        ),
        h(
          Button,
          {
            size: "sm",
            variant: "secondary",
            disabled: syncingId.value === account.id,
            onClick: () => void syncNow(account)
          },
          () => (syncingId.value === account.id ? "Синхронизируем…" : "Синхронизировать")
        ),
        h(
          Button,
          { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = account.id) },
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
      title="Telegram"
      description="Пользовательские аккаунты Telegram для синхронизации диалогов. api_hash и сессия хранятся локально и не показываются в интерфейсе."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить Telegram-аккаунты</AlertTitle>
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

    <Alert v-if="syncResult" :variant="syncResult.errors.length > 0 ? 'warning' : 'info'" class="mb-4">
      <CircleAlert />
      <AlertTitle>Синхронизация завершена</AlertTitle>
      <AlertDescription>
        <p>
          Обработано: {{ syncResult.processed }} · вставлено: {{ syncResult.inserted }} ·
          обновлено: {{ syncResult.updated }} · пропущено: {{ syncResult.skipped }} ·
          контактов: {{ syncResult.contacts }} · связей: {{ syncResult.linked }}
        </p>
        <ul v-if="syncResult.errors.length > 0" class="mt-2 list-disc space-y-1 pl-4">
          <li v-for="error in syncResult.errors" :key="error">{{ error }}</li>
        </ul>
      </AlertDescription>
    </Alert>

    <Card v-if="qrAccount" class="mb-4">
      <CardHeader>
        <CardTitle>Подключение «{{ qrAccount.label }}» по QR</CardTitle>
        <CardDescription>
          Откройте Telegram → Настройки → Устройства → Подключить устройство и отсканируйте
          QR-код. Телефон и api_hash в этом окне не показываются.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col items-center gap-4">
        <QrcodeVue
          v-if="qrUrl"
          :value="qrUrl"
          :size="220"
          level="M"
          class="rounded-lg bg-white p-3"
        />
        <div
          v-else-if="loginStatus === 'authorized'"
          class="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-center text-sm text-emerald-800 dark:text-emerald-200"
        >
          Аккаунт подключён
        </div>
        <div
          v-else-if="loginStatus === 'error'"
          class="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-center text-sm text-red-800 dark:text-red-200"
        >
          Не удалось получить QR
        </div>
        <div v-else class="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Готовим QR-код…
        </div>

        <div class="max-w-md space-y-1 text-center text-xs text-muted-foreground">
          <p v-if="qrUrl">
            Ссылка для Telegram Desktop:
            <a :href="qrUrl" class="break-all text-sky-700 dark:text-sky-300 underline-offset-4 hover:underline">
              {{ qrUrl }}
            </a>
          </p>
          <p v-if="qrExpiresAt">Действует до {{ formatDate(qrExpiresAt) }}.</p>
          <p v-if="isPolling">Ожидаем подтверждение в Telegram…</p>
        </div>

        <StatusBadge :value="loginStatus" />

        <p v-if="loginError" class="text-sm text-red-700 dark:text-red-300">{{ loginError }}</p>

        <Button variant="outline" size="sm" @click="closeQr">
          <QrCode />
          Закрыть подключение
        </Button>
      </CardContent>
    </Card>

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>Новый Telegram-аккаунт</CardTitle>
        <CardDescription>
          Создайте приложение на my.telegram.org и возьмите api_id и api_hash. После добавления
          подключите аккаунт по QR-коду.
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
              <Label for="telegram-label">Название</Label>
              <Input
                id="telegram-label"
                v-model="label"
                placeholder="Личный Telegram"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="telegram-api-id">api_id</Label>
              <Input
                id="telegram-api-id"
                v-model="apiId"
                type="number"
                min="1"
                step="1"
                placeholder="12345678"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="telegram-api-hash">api_hash</Label>
              <Input
                id="telegram-api-hash"
                v-model="apiHash"
                type="password"
                autocomplete="off"
                placeholder="Секрет приложения Telegram"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                Хранится локально, в интерфейс не возвращается.
              </p>
            </div>
            <div class="space-y-2">
              <Label for="telegram-phone">Телефон, необязательно</Label>
              <Input
                id="telegram-phone"
                v-model="phone"
                type="tel"
                placeholder="+7 900 000-00-00"
                :disabled="isSaving"
              />
            </div>
          </div>

          <Button type="submit" :disabled="isSaving">
            <Send />
            {{ isSaving ? "Сохраняем…" : "Добавить аккаунт" }}
          </Button>
        </form>
      </CardContent>
    </Card>

    <DataTable
      :columns="columns"
      :data="accounts"
      :is-loading="isListPending"
      :loading-row-count="5"
      empty-title="Telegram-аккаунтов нет"
      empty-description="Добавьте api_id и api_hash, затем подключите аккаунт по QR-коду. api_hash и сессия хранятся в локальных секретах, а не в Postgres."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Аккаунтов: {{ accounts.length }}</span>
      </template>
      <template #empty>
        <EmptyState
          title="Telegram-аккаунтов нет"
          description="Добавьте api_id и api_hash, затем подключите аккаунт по QR-коду. api_hash и сессия хранятся в локальных секретах, а не в Postgres."
        />
      </template>
    </DataTable>
  </section>
</template>
