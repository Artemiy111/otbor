<script setup lang="ts">
import { computed, h, ref } from "vue"
import { refDebounced } from "@vueuse/core"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { PeopleRelinkResult, PersonSummary } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, RefreshCw } from "@lucide/vue"
import { personApi, personKeys } from "@/entities/person"
import { describeError, formatDate, personPath } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DataTable,
  Input,
  Label,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import EmployerName from "./EmployerName.vue"
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

const people = computed<ReadonlyArray<PersonSummary>>(() => query.data.value?.items ?? [])
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
const actionError = ref<string | null>(null)

const relink = async () => {
  actionError.value = null
  relinking.value = true
  try {
    relinkResult.value = await relinkMutation.mutateAsync()
    await queryCache.invalidateQueries({ key: personKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    relinking.value = false
  }
}

const columns: ColumnDef<PersonSummary>[] = [
  {
    id: "name",
    accessorFn: (row) => row.displayName ?? "",
    header: sortableHeader<PersonSummary>("Имя"),
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
    header: sortableHeader<PersonSummary>("Роль"),
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
    accessorKey: "contactCount",
    header: sortableHeader<PersonSummary>("Контакты"),
    cell: ({ row }) => String(row.original.contactCount)
  },
  {
    accessorKey: "conversationCount",
    header: sortableHeader<PersonSummary>("Диалоги"),
    cell: ({ row }) => String(row.original.conversationCount)
  },
  {
    id: "lastSeenAt",
    accessorFn: (row) => row.lastSeenAt ?? "",
    header: sortableHeader<PersonSummary>("Был на связи"),
    cell: ({ row }) => formatDate(row.original.lastSeenAt)
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Люди"
      description="Живые собеседники: рекрутеры и нанимающие менеджеры. Человек объединяет контакты и диалоги из разных каналов."
    >
      <template #actions>
        <Button variant="outline" :disabled="relinking" @click="relink">
          <RefreshCw :class="relinking ? 'animate-spin' : ''" />
          {{ relinking ? "Пересчитываем…" : "Пересчитать связи" }}
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить людей</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>
    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось пересчитать связи</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
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
      empty-title="Людей нет"
      empty-description="Люди появляются после синхронизации почты или Telegram. Нажмите «Пересчитать связи», если контакты уже есть."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">
          Показано {{ people.length }} из {{ total }}
        </span>
      </template>
    </DataTable>
  </section>
</template>
