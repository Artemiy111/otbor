<script setup lang="ts">
import { computed, h, ref } from "vue"
import { refDebounced } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { ConversationChannel, ConversationSummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { conversationApi, conversationKeys } from "@/entities/conversation"
import {
  conversationChannelLabel,
  describeError,
  formatDate,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  sortableHeader
} from "@/shared/ui"
import ConversationDetail from "./ConversationDetail.vue"

const channel = ref("all")
const search = ref("")
const debouncedSearch = refDebounced(search, 300)
const selectedId = ref<string | null>(null)

const query = useQuery({
  key: () => conversationKeys.list(channel.value, debouncedSearch.value.trim()),
  query: () =>
    conversationApi.list({
      channel: channel.value === "all" ? undefined : (channel.value as ConversationChannel),
      query: debouncedSearch.value.trim() === "" ? undefined : debouncedSearch.value.trim(),
      limit: 200
    })
})

const conversations = computed<ReadonlyArray<ConversationSummary>>(
  () => query.data.value ?? []
)
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

const open = (conversation: ConversationSummary) => {
  selectedId.value = conversation.id
}

const close = () => {
  selectedId.value = null
}

const columns: ColumnDef<ConversationSummary>[] = [
  {
    id: "title",
    accessorFn: (row) => [row.title, row.personName, row.personRole].filter(Boolean).join(" "),
    header: sortableHeader<ConversationSummary>("Диалог"),
    cell: ({ row }) => {
      const conversation = row.original
      return h("div", { class: "max-w-[340px]" }, [
        h(
          "button",
          {
            type: "button",
            class: "text-left font-medium text-foreground transition-colors hover:text-primary",
            onClick: () => open(conversation)
          },
          conversation.title ?? conversation.personName ?? conversation.externalId
        ),
        h(
          "div",
          { class: "text-xs text-muted-foreground" },
          [conversation.personName, conversation.personRole].filter(Boolean).join(" · ") ||
            "Участник не указан"
        )
      ])
    }
  },
  {
    id: "lastMessage",
    accessorFn: (row) => row.lastMessage ?? "",
    header: "Последнее сообщение",
    enableSorting: false,
    cell: ({ row }) => {
      const message = row.original.lastMessage
      return h("div", { class: "max-w-[320px]" }, [
        h(
          "p",
          { class: "truncate text-sm text-muted-foreground", title: message ?? undefined },
          message === null || message === "" ? "—" : message
        ),
        h(
          "div",
          { class: "text-[11px] text-muted-foreground" },
          formatDate(row.original.lastMessageAt)
        )
      ])
    }
  },
  {
    id: "channel",
    accessorFn: (row) => conversationChannelLabel(row.channel),
    header: sortableHeader<ConversationSummary>("Канал"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.channel === "telegram" ? "info" : "secondary" },
        () => conversationChannelLabel(row.original.channel)
      )
  },
  {
    accessorKey: "unreadCount",
    header: sortableHeader<ConversationSummary>("Непрочитанные"),
    cell: ({ row }) =>
      row.original.unreadCount > 0
        ? h(Badge, { variant: "warning" }, () => String(row.original.unreadCount))
        : h("span", { class: "text-muted-foreground" }, "—")
  },
  {
    id: "vacancy",
    accessorFn: (row) => row.vacancyId ?? "",
    header: sortableHeader<ConversationSummary>("Вакансия"),
    cell: ({ row }) => {
      const vacancyId = row.original.vacancyId
      if (vacancyId === null) return h("span", { class: "text-muted-foreground" }, "—")
      return h(
        "a",
        {
          href: vacancyPath(vacancyId),
          class: "text-sm text-sky-300 underline-offset-4 hover:underline"
        },
        "Открыть"
      )
    }
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) =>
      h(
        Button,
        { size: "sm", variant: "outline", onClick: () => open(row.original) },
        () => "Открыть"
      )
  }
]
</script>

<template>
  <div>
    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить диалоги</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div class="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_210px]">
      <div class="space-y-1.5">
        <Label for="conversations-search" class="text-xs text-muted-foreground">Поиск</Label>
        <Input
          id="conversations-search"
          v-model="search"
          type="search"
          placeholder="Тема, участник, текст сообщения…"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="conversations-channel" class="text-xs text-muted-foreground">Канал</Label>
        <Select :model-value="channel" @update:model-value="(value) => (channel = String(value))">
          <SelectTrigger id="conversations-channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все каналы</SelectItem>
            <SelectItem value="mail">Почта</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
            <SelectItem value="hh_chat">Чат hh</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <DataTable
      :columns="columns"
      :data="conversations"
      :is-loading="isListPending"
      :loading-row-count="6"
      empty-title="Диалогов нет"
      empty-description="Диалоги появляются после синхронизации почты или Telegram. Чаты hh требуют browser harness и пока не синхронизируются."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">
          Диалогов: {{ conversations.length }}
        </span>
      </template>
    </DataTable>

    <Sheet :open="selectedId !== null" @update:open="(value) => (!value ? close() : undefined)">
      <SheetContent class="flex w-full flex-col p-0 sm:max-w-xl">
        <SheetTitle class="sr-only">Диалог</SheetTitle>
        <SheetDescription class="sr-only">История сообщений диалога</SheetDescription>
        <ConversationDetail v-if="selectedId" :id="selectedId" />
      </SheetContent>
    </Sheet>
  </div>
</template>
