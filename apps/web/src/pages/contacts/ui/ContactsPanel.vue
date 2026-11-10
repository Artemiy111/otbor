<script setup lang="ts">
import { computed, h, ref } from "vue"
import { refDebounced } from "@vueuse/core"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ContactKind, ContactRecord, ContactSource } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Download, Mail, Send } from "@lucide/vue"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { contactApi, contactKeys, type ContactsExtractResult } from "@/entities/contact"
import {
  contactHref,
  contactKindLabel,
  contactSourceLabel,
  describeError,
  formatDate,
  personPath,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  sortableHeader
} from "@/shared/ui"

const search = ref("")
const debouncedSearch = refDebounced(search, 300)
const kind = ref("all")
const source = ref("all")

const query = useQuery({
  key: () =>
    contactKeys.list({
      query: debouncedSearch.value.trim(),
      kind: kind.value,
      source: source.value
    }),
  query: () =>
    contactApi.list({
      query: debouncedSearch.value.trim() === "" ? undefined : debouncedSearch.value.trim(),
      kind: kind.value === "all" ? undefined : (kind.value as ContactKind),
      source: source.value === "all" ? undefined : (source.value as ContactSource),
      limit: 200,
      offset: 0
    })
})

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const accounts = computed(() => accountsQuery.data.value ?? [])

const queryCache = useQueryCache()
const contacts = computed<ReadonlyArray<ContactRecord>>(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? contacts.value.length)
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

const extractMutation = useMutation<ContactsExtractResult, void>({
  mutation: () => contactApi.extract()
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => contactApi.remove(id)
})

const notice = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const actionError = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const extracting = ref(false)

const extract = async () => {
  actionError.value = null
  notice.value = null
  extracting.value = true
  try {
    const result = await extractMutation.mutateAsync()
    noticeTone.value = "info"
    notice.value = `Просканировано вакансий: ${result.scanned}. Найдено контактов: ${result.contacts}.`
    await queryCache.invalidateQueries({ key: contactKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    extracting.value = false
  }
}

const remove = async (contact: ContactRecord) => {
  actionError.value = null
  notice.value = null
  removingId.value = contact.id
  try {
    const result = await removeMutation.mutateAsync(contact.id)
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Контакт удалён." : "Контакт не удалён: запись не найдена."
    await queryCache.invalidateQueries({ key: contactKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    removingId.value = null
  }
}

const columns: ColumnDef<ContactRecord>[] = [
  {
    id: "person",
    accessorFn: (row) => [row.personName, row.personRole].filter(Boolean).join(" "),
    header: sortableHeader<ContactRecord>("Имя и роль"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[220px]" }, [
        h(
          "div",
          { class: "font-medium" },
          row.original.personName ?? "Имя не указано"
        ),
        row.original.personRole === null
          ? null
          : h(
              "div",
              { class: "text-xs text-muted-foreground" },
              row.original.personRole
            )
      ])
  },
  {
    id: "personLink",
    accessorFn: (row) => row.personName ?? "",
    header: sortableHeader<ContactRecord>("Человек"),
    cell: ({ row }) => {
      const { personId, personLink } = row.original
      if (personId === null) return h("span", { class: "text-muted-foreground" }, "—")
      return h("div", { class: "flex items-center gap-1.5" }, [
        h(
          "a",
          {
            href: personPath(personId),
            class: "text-sm text-info underline-offset-4 hover:underline"
          },
          row.original.personName ?? "Открыть"
        ),
        personLink === "suggested" ? h(Badge, { variant: "warning" }, () => "предложено") : null
      ])
    }
  },
  {
    accessorKey: "value",
    header: sortableHeader<ContactRecord>("Контакт"),
    cell: ({ row }) => {
      const contact = row.original
      const href = contactHref(contact)
      const external = href !== null && /^https?:\/\//i.test(href)
      return h("div", { class: "max-w-[280px]" }, [
        href === null
          ? h("span", { class: "break-all text-sm" }, contact.value)
          : h(
              "a",
              {
                href,
                target: external ? "_blank" : undefined,
                rel: external ? "noreferrer" : undefined,
                class:
                  "break-all text-sm text-info underline-offset-4 hover:underline"
              },
              contact.value
            ),
        h(
          "div",
          { class: "text-xs text-muted-foreground" },
          contact.isBot
            ? `${contactKindLabel(contact.kind)} · бот`
            : contactKindLabel(contact.kind)
        )
      ])
    }
  },
  {
    id: "source",
    accessorFn: (row) => contactSourceLabel(row.source),
    header: sortableHeader<ContactRecord>("Источник"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.source === "hh_vacancy" ? "info" : "secondary" },
        () => contactSourceLabel(row.original.source)
      )
  },
  {
    id: "hhAccount",
    enableSorting: false,
    header: "Аккаунт hh",
    cell: ({ row }) =>
      row.original.hhAccountIds.length === 0
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h(
            "div",
            { class: "flex items-center gap-1" },
            row.original.hhAccountIds.map((id) =>
              h(AccountChip, { accountId: id, accounts: accounts.value })
            )
          )
  },
  {
    id: "vacancy",
    accessorFn: (row) => row.vacancyId ?? "",
    header: sortableHeader<ContactRecord>("Вакансия"),
    cell: ({ row }) => {
      const vacancyId = row.original.vacancyId
      if (vacancyId === null) return h("span", { class: "text-muted-foreground" }, "—")
      return h(
        "a",
        {
          href: vacancyPath(vacancyId),
          class: "text-sm text-info underline-offset-4 hover:underline"
        },
        "Открыть"
      )
    }
  },
  {
    accessorKey: "lastSeenAt",
    header: sortableHeader<ContactRecord>("Последний раз"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.lastSeenAt)
      )
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) => {
      const contact = row.original
      if (confirmDeleteId.value === contact.id) {
        return h("div", { class: "flex items-center gap-1.5" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Удалить?"),
          h(
            Button,
            {
              size: "sm",
              variant: "destructive",
              disabled: removingId.value === contact.id,
              onClick: () => void remove(contact)
            },
            () => (removingId.value === contact.id ? "Удаляем…" : "Да")
          ),
          h(
            Button,
            { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = null) },
            () => "Отмена"
          )
        ])
      }
      return h(
        Button,
        {
          size: "sm",
          variant: "ghost",
          onClick: () => (confirmDeleteId.value = contact.id)
        },
        () => "Удалить"
      )
    }
  }
]
</script>

<template>
  <div>
    <p class="mb-4 max-w-3xl text-sm text-muted-foreground">
      Здесь все способы связи (почта, Telegram, телефон), которые нашлись в вакансиях и переписке, — для проверки.
      Один человек может стоять за несколькими контактами: их объединяет вкладка «<a href="/people" class="text-info underline-offset-4 hover:underline">Люди</a>».
    </p>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить контакты</AlertTitle>
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

    <div class="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_210px_210px]">
      <div class="space-y-1.5">
        <Label for="contacts-search" class="text-xs text-muted-foreground">Поиск</Label>
        <Input
          id="contacts-search"
          v-model="search"
          type="search"
          placeholder="Имя, роль, email, телефон…"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="contacts-kind" class="text-xs text-muted-foreground">Тип контакта</Label>
        <Select :model-value="kind" @update:model-value="(value) => (kind = String(value))">
          <SelectTrigger id="contacts-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
            <SelectItem value="telegram_id">Telegram ID</SelectItem>
            <SelectItem value="phone">Телефон</SelectItem>
            <SelectItem value="hh_chat">Чат hh</SelectItem>
            <SelectItem value="other">Другое</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="contacts-source" class="text-xs text-muted-foreground">Источник</Label>
        <Select :model-value="source" @update:model-value="(value) => (source = String(value))">
          <SelectTrigger id="contacts-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все источники</SelectItem>
            <SelectItem value="hh_vacancy">Вакансия hh</SelectItem>
            <SelectItem value="mail">Почта</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
            <SelectItem value="hh_chat">Чат hh</SelectItem>
            <SelectItem value="manual">Вручную</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="outline" :disabled="extracting" @click="extract">
        <Download />
        {{ extracting ? "Ищем контакты…" : "Найти контакты в вакансиях заново" }}
      </Button>
      <span class="text-xs text-muted-foreground">
        Перечитывает тексты уже сохранённых вакансий и добавляет найденные контакты. Ничего не удаляет; нужно после обновления разбора вакансий.
      </span>
    </div>

    <DataTable
      :columns="columns"
      :data="contacts"
      :is-loading="isListPending"
      :loading-row-count="6"
      empty-title="Контактов нет"
      empty-description="hh.ru редко показывает контакты в тексте вакансии. Подключите почту или Telegram — переписка пополнит контакты автоматически."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">
          Показано {{ contacts.length }} из {{ total }}
        </span>
      </template>
      <template #empty>
        <EmptyState
          title="Контактов нет"
          description="hh.ru редко показывает контакты в тексте вакансии. Подключите почту или Telegram — переписка пополнит контакты автоматически."
        >
          <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button as-child variant="outline" size="sm">
              <a href="/mail"><Mail />Почта</a>
            </Button>
            <Button as-child variant="outline" size="sm">
              <a href="/telegram"><Send />Telegram</a>
            </Button>
          </div>
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>
