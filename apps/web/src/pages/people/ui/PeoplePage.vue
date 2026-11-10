<script setup lang="ts">
import { computed, h, ref } from "vue"
import { refDebounced } from "@vueuse/core"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { PeopleRelinkResult, PersonSummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, RefreshCw } from "@lucide/vue"
import { unreadByPerson, useConversations } from "@/entities/conversation"
import { EmployerName, personApi, personKeys } from "@/entities/person"
import { describeError, formatDate, personPath } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  DataTable,
  Input,
  Label,
  sortableHeader,
  useToast
} from "@/shared/ui"
import ConfirmAction from "./ConfirmAction.vue"
import MergeSuggestions from "./MergeSuggestions.vue"

const search = ref("")
const debouncedSearch = refDebounced(search, 300)

const query = useQuery({
  key: () => personKeys.list(debouncedSearch.value.trim()),
  query: () =>
    personApi.list({
      query: debouncedSearch.value.trim() === "" ? undefined : debouncedSearch.value.trim(),
      limit: 200,
      offset: 0
    })
})

const conversations = useConversations()
const unread = computed(() => unreadByPerson(conversations.data.value ?? []))

/** Строка таблицы: человек и число его непрочитанных сообщений (считается по списку диалогов). */
interface PersonRow extends PersonSummary {
  readonly unread: number
}

const people = computed<ReadonlyArray<PersonRow>>(() =>
  (query.data.value?.items ?? []).map((person) => ({ ...person, unread: unread.value.get(person.id) ?? 0 }))
)
const total = computed(() => query.data.value?.total ?? people.value.length)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

const queryCache = useQueryCache()
const relinkMutation = useMutation<PeopleRelinkResult, void>({
  mutation: () => personApi.relink()
})
const relinking = ref(false)
const relinkResult = ref<PeopleRelinkResult | null>(null)
const toast = useToast()

const relink = async () => {
  relinking.value = true
  try {
    relinkResult.value = await relinkMutation.mutateAsync()
    await queryCache.invalidateQueries({ key: personKeys.all })
    toast.success("Связи пересчитаны", { description: "Итог показан над списком." })
  } catch (error) {
    toast.error("Не удалось пересчитать связи", { description: describeError(error) })
  } finally {
    relinking.value = false
  }
}

const columns: ColumnDef<PersonRow>[] = [
  {
    id: "name",
    accessorFn: (row) => row.displayName ?? "",
    header: sortableHeader<PersonRow>("Имя"),
    cell: ({ row }) =>
      h(
        "a",
        {
          href: personPath(row.original.id),
          class: "font-medium text-foreground transition-colors hover:text-primary"
        },
        row.original.displayName ?? "Без имени"
      )
  },
  {
    id: "role",
    accessorFn: (row) => row.role ?? "",
    header: sortableHeader<PersonRow>("Роль"),
    cell: ({ row }) =>
      row.original.role === null
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h("span", { class: "text-sm" }, row.original.role)
  },
  {
    id: "company",
    enableSorting: false,
    header: "Компания",
    cell: ({ row }) => h(EmployerName, { id: row.original.employerId })
  },
  {
    accessorKey: "conversationCount",
    header: sortableHeader<PersonRow>("Диалоги"),
    cell: ({ row }) => h("span", { class: "tabular-nums" }, String(row.original.conversationCount))
  },
  {
    id: "lastSeenAt",
    accessorFn: (row) => row.lastSeenAt ?? "",
    header: sortableHeader<PersonRow>("Последний контакт"),
    cell: ({ row }) => h("span", { class: "whitespace-nowrap tabular-nums text-muted-foreground" }, formatDate(row.original.lastSeenAt))
  },
  {
    accessorKey: "unread",
    header: sortableHeader<PersonRow>("Непрочитанные"),
    cell: ({ row }) => {
      const count = row.original.unread
      return count > 0
        ? h(Badge, { variant: "warning" }, () => String(count))
        : h("span", { class: "text-muted-foreground" }, "—")
    }
  }
]
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <p class="max-w-3xl text-sm text-muted-foreground">
        Живые собеседники: рекрутеры и нанимающие менеджеры. Один человек объединяет несколько контактов
        (почта, Telegram, телефон) и диалоги из разных каналов.
      </p>
      <ConfirmAction
        label="Пересчитать связи"
        confirm-label="Да, пересчитать"
        hint="Заново свяжет контакты, диалоги и вакансии с людьми и предложит дубликаты. Ничего не удаляет и не объединяет само."
        :busy="relinking"
        @confirm="relink"
      >
        <RefreshCw :class="relinking ? 'animate-spin' : ''" />
        {{ relinking ? "Пересчитываем…" : "Пересчитать связи" }}
      </ConfirmAction>
    </div>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить людей</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>
    <Alert v-if="relinkResult" variant="info" class="mb-4">
      <CircleAlert />
      <AlertTitle>Связи пересчитаны</AlertTitle>
      <AlertDescription>
        Диалогов: {{ relinkResult.conversations }}, новых людей: {{ relinkResult.peopleCreated }},
        привязано контактов: {{ relinkResult.contactsLinked }}, связей с вакансиями:
        {{ relinkResult.vacancyLinks }}, с резюме: {{ relinkResult.resumeLinks }}.
      </AlertDescription>
    </Alert>
    <MergeSuggestions v-if="relinkResult" :suggestions="relinkResult.mergeSuggestions" />

    <div class="mb-4 max-w-md space-y-1.5">
      <Label for="people-search" class="text-xs text-muted-foreground">Поиск</Label>
      <Input id="people-search" v-model="search" type="search" placeholder="Имя, роль, контакт…" />
    </div>

    <DataTable
      :columns="columns"
      :data="people"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      :initial-sorting="[{ id: 'unread', desc: true }]"
      empty-title="Людей нет"
      empty-description="Люди появляются после синхронизации почты или Telegram. Если контакты уже есть, нажмите «Пересчитать связи»."
    >
      <template #toolbar>
        <span class="pb-2 text-xs tabular-nums text-muted-foreground">
          Показано {{ people.length }} из {{ total }}
        </span>
      </template>
    </DataTable>
  </div>
</template>
