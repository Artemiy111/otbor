<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { MailAccountRecord, SyncResult } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import {
  mailAccountApi,
  mailAccountKeys,
  type MailAccountTestResult,
  type MailAccountUpsertInput
} from "@/entities/mail-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, toneClasses } from "@/shared/lib"
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
  Input,
  Label,
  StatusBadge,
  sortableHeader,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => mailAccountKeys.list(),
  query: () => mailAccountApi.list()
})

const accounts = computed<ReadonlyArray<MailAccountRecord>>(() => query.data.value ?? [])
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

const queryCache = useQueryCache()

const upsertMutation = useMutation<MailAccountRecord, MailAccountUpsertInput>({
  mutation: (input) => mailAccountApi.upsert(input)
})

const testMutation = useMutation<MailAccountTestResult, string>({
  mutation: (id) => mailAccountApi.test(id)
})

const syncMutation = useMutation<SyncResult, string>({
  mutation: (id) => mailAccountApi.sync(id)
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => mailAccountApi.remove(id)
})

const editingId = ref<string | null>(null)
const label = ref("")
const address = ref("")
const host = ref("")
const port = ref("993")
const secure = ref(true)
const username = ref("")
const password = ref("")
const includeSent = ref(false)
const backfillDays = ref("30")
const enabled = ref(true)

const formError = ref<string | null>(null)
const toast = useToast()
const testResult = ref<MailAccountTestResult | null>(null)
const syncResult = ref<SyncResult | null>(null)
const testingId = ref<string | null>(null)
const syncingId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)

const isEditing = computed(() => editingId.value !== null)
const isSaving = computed(() => upsertMutation.isLoading.value)

const resetForm = () => {
  editingId.value = null
  label.value = ""
  address.value = ""
  host.value = ""
  port.value = "993"
  secure.value = true
  username.value = ""
  password.value = ""
  includeSent.value = false
  backfillDays.value = "30"
  enabled.value = true
  formError.value = null
}

const fillForm = (account: MailAccountRecord) => {
  editingId.value = account.id
  label.value = account.label
  address.value = account.address
  host.value = account.host
  port.value = String(account.port)
  secure.value = account.secure
  username.value = account.username
  password.value = ""
  includeSent.value = account.includeSent
  backfillDays.value = String(account.backfillDays)
  enabled.value = account.enabled
  formError.value = null
  confirmDeleteId.value = null
}

const submit = async () => {
  testResult.value = null
  syncResult.value = null

  const trimmedLabel = label.value.trim()
  const trimmedAddress = address.value.trim()
  const trimmedHost = host.value.trim()
  const trimmedUsername = username.value.trim()
  if (trimmedLabel === "" || trimmedAddress === "" || trimmedHost === "") {
    formError.value = "Заполните название, адрес и IMAP-хост."
    return
  }
  if (trimmedUsername === "") {
    formError.value = "Введите логин IMAP."
    return
  }

  const portNumber = Number(port.value)
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    formError.value = "Порт должен быть целым числом от 1 до 65535."
    return
  }

  const days = Number(backfillDays.value)
  if (!Number.isInteger(days) || days < 0 || days > 3_650) {
    formError.value = "Глубина должна быть целым числом дней от 0 до 3650."
    return
  }

  if (!isEditing.value && password.value.trim() === "") {
    formError.value = "Для нового аккаунта нужен пароль приложения."
    return
  }

  formError.value = null
  const wasEditing = isEditing.value

  try {
    await upsertMutation.mutateAsync({
      ...(editingId.value === null ? {} : { id: editingId.value }),
      label: trimmedLabel,
      address: trimmedAddress,
      host: trimmedHost,
      port: portNumber,
      secure: secure.value,
      username: trimmedUsername,
      ...(password.value.trim() === "" ? {} : { password: password.value }),
      includeSent: includeSent.value,
      backfillDays: days,
      enabled: enabled.value
    })
    resetForm()
    toast.success(wasEditing ? "Почтовый аккаунт обновлён" : "Почтовый аккаунт добавлен")
    await queryCache.invalidateQueries({ key: mailAccountKeys.all })
  } catch (error) {
    toast.error("Не удалось сохранить почтовый аккаунт", { description: describeError(error) })
  }
}

const testConnection = async (account: MailAccountRecord) => {
  syncResult.value = null
  testResult.value = null
  testingId.value = account.id
  try {
    testResult.value = await testMutation.mutateAsync(account.id)
  } catch (error) {
    toast.error("Не удалось проверить подключение", { description: describeError(error) })
  } finally {
    testingId.value = null
  }
}

const syncNow = async (account: MailAccountRecord) => {
  testResult.value = null
  syncResult.value = null
  syncingId.value = account.id
  try {
    syncResult.value = await syncMutation.mutateAsync(account.id)
    if (syncResult.value.errors.length === 0) toast.success("Синхронизация завершена")
    else toast.warning("Синхронизация завершена с ошибками", { description: "Подробности под заголовком страницы." })
    await queryCache.invalidateQueries({ key: mailAccountKeys.all })
  } catch (error) {
    toast.error("Не удалось синхронизировать почту", { description: describeError(error) })
  } finally {
    syncingId.value = null
  }
}

const remove = async (account: MailAccountRecord) => {
  removingId.value = account.id
  try {
    const result = await removeMutation.mutateAsync(account.id)
    if (editingId.value === account.id) resetForm()
    confirmDeleteId.value = null
    if (result.deleted) toast.success("Почтовый аккаунт удалён")
    else toast.warning("Аккаунт не удалён", { description: "Запись не найдена." })
    await queryCache.invalidateQueries({ key: mailAccountKeys.all })
  } catch (error) {
    toast.error("Не удалось удалить почтовый аккаунт", { description: describeError(error) })
  } finally {
    removingId.value = null
  }
}

const columns: ColumnDef<MailAccountRecord>[] = [
  {
    id: "account",
    accessorFn: (row) => `${row.label} ${row.address}`,
    header: sortableHeader<MailAccountRecord>("Аккаунт"),
    cell: ({ row }) =>
      h("div", { class: "max-w-72" }, [
        h("div", { class: "font-medium" }, row.original.label),
        h("div", { class: "break-all text-xs text-muted-foreground" }, row.original.address)
      ])
  },
  {
    id: "host",
    accessorFn: (row) => `${row.host}:${row.port}`,
    header: sortableHeader<MailAccountRecord>("IMAP"),
    cell: ({ row }) =>
      h("div", null, [
        h("code", { class: "text-xs" }, `${row.original.host}:${row.original.port}`),
        h(
          "div",
          { class: "text-xs text-muted-foreground" },
          row.original.secure ? "TLS" : "без TLS"
        )
      ])
  },
  {
    accessorKey: "status",
    header: sortableHeader<MailAccountRecord>("Статус"),
    cell: ({ row }) =>
      h(StatusBadge, { value: row.original.status })
  },
  {
    accessorKey: "lastSyncAt",
    header: sortableHeader<MailAccountRecord>("Последняя синхронизация"),
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
        { class: `block max-w-60 truncate text-xs ${toneClasses("danger").text}`, title: error },
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
            disabled: testingId.value === account.id,
            onClick: () => void testConnection(account)
          },
          () => (testingId.value === account.id ? "Проверяем…" : "Проверить")
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
          { size: "sm", variant: "ghost", onClick: () => fillForm(account) },
          () => "Изменить"
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
      title="Почта"
      description="IMAP-аккаунты для синхронизации переписки и контактов. Пароль приложения хранится локально и не возвращается в интерфейс."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить почтовые аккаунты</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <Alert v-if="testResult" :variant="testResult.ok ? 'info' : 'warning'" class="mb-4">
      <CircleAlert />
      <AlertTitle>
        {{ testResult.ok ? "Подключение работает" : "Подключение не подтверждено" }}
      </AlertTitle>
      <AlertDescription>
        {{ testResult.address }} · папок: {{ testResult.folders }} ·
        писем:
        {{ testResult.messages === null ? "не подсчитано" : testResult.messages }}
      </AlertDescription>
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

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>{{ isEditing ? "Изменить почтовый аккаунт" : "Новый почтовый аккаунт" }}</CardTitle>
        <CardDescription>
          Используйте пароль приложения IMAP, а не основной пароль от почты. Секрет остаётся
          в локальном хранилище и не попадает в Postgres.
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
              <Label for="mail-label">Название</Label>
              <Input
                id="mail-label"
                v-model="label"
                placeholder="Рабочая почта"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="mail-address">Адрес</Label>
              <Input
                id="mail-address"
                v-model="address"
                type="email"
                placeholder="me@example.com"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="mail-host">IMAP-хост</Label>
              <Input
                id="mail-host"
                v-model="host"
                placeholder="imap.example.com"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="mail-port">Порт</Label>
              <Input
                id="mail-port"
                v-model="port"
                type="number"
                min="1"
                max="65535"
                step="1"
                :disabled="isSaving"
              />
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="secure"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                TLS
              </Label>
            </div>
            <div class="space-y-2">
              <Label for="mail-username">Логин</Label>
              <Input
                id="mail-username"
                v-model="username"
                autocomplete="username"
                :disabled="isSaving"
              />
            </div>
            <div class="space-y-2">
              <Label for="mail-password">Пароль приложения</Label>
              <Input
                id="mail-password"
                v-model="password"
                type="password"
                autocomplete="new-password"
                :placeholder="isEditing ? 'Оставьте пустым, чтобы не менять' : 'Пароль приложения IMAP'"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                <template v-if="isEditing">
                  Пароль не отображается. Пустое поле сохраняет текущий секрет.
                </template>
                <template v-else>
                  Хранится в локальных секретах, в интерфейс не возвращается.
                </template>
              </p>
            </div>
            <div class="space-y-2">
              <Label for="mail-backfill">Глубина, дней</Label>
              <Input
                id="mail-backfill"
                v-model="backfillDays"
                type="number"
                min="0"
                max="3650"
                step="1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                Сколько дней истории читать при синхронизации.
              </p>
            </div>
            <div class="space-y-2">
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="includeSent"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                Читать папку «Отправленные»
              </Label>
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="enabled"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                Аккаунт включён
              </Label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="isSaving">
              {{ isEditing ? "Сохранить" : "Добавить аккаунт" }}
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
          </div>
        </form>
      </CardContent>
    </Card>

    <DataTable
      :columns="columns"
      :data="accounts"
      :is-loading="isListPending"
      :loading-row-count="5"
      empty-title="Почтовых аккаунтов нет"
      empty-description="Заполните форму выше, чтобы синхронизировать переписку и пополнять контакты. Создайте отдельный пароль приложения в настройках почты: основной пароль не нужен."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Аккаунтов: {{ accounts.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
