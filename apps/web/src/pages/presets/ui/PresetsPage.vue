<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { KeywordId, PresetRecord } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import {
  presetApi,
  presetKeys,
  type PresetUpsertInput
} from "@/entities/preset"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  payloadPreview,
  payloadText,
  presetKindLabel
} from "@/shared/lib"
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
import PresetKeywordPicker from "./PresetKeywordPicker.vue"

const kind = ref("all")

const query = useQuery({
  key: () => presetKeys.list(kind.value),
  query: () =>
    presetApi.list({
      kind: kind.value === "all" ? undefined : kind.value
    })
})

const lexiconQuery = useQuery({
  key: () => keywordKeys.list(""),
  query: () => keywordApi.list({ limit: 5000 })
})

const presets = computed<ReadonlyArray<PresetRecord>>(() => query.data.value ?? [])
const lexicon = computed(() => lexiconQuery.data.value ?? [])

const queryCache = useQueryCache()

const upsertMutation = useMutation<PresetRecord, PresetUpsertInput>({
  mutation: (input) => presetApi.upsert(input),
  async onSuccess() {
    await Promise.all([
      queryCache.invalidateQueries({ key: presetKeys.all }),
      queryCache.invalidateQueries({ key: keywordKeys.all })
    ])
  }
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => presetApi.remove(id),
  async onSuccess() {
    await Promise.all([
      queryCache.invalidateQueries({ key: presetKeys.all }),
      queryCache.invalidateQueries({ key: keywordKeys.all })
    ])
  }
})

const editingId = ref<string | null>(null)
const title = ref("")
const presetKind = ref("explore")
const filterText = ref("")
const gate = ref("any")
const includeArchived = ref(false)
const keywordIds = ref<KeywordId[]>([])
const formError = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const removingId = ref<string | null>(null)

const isEditing = computed(() => editingId.value !== null)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
const writeErrorText = computed(() => {
  const failure = upsertMutation.error.value ?? removeMutation.error.value
  return failure === null ? null : describeError(failure)
})
const lexiconErrorText = computed(() =>
  lexiconQuery.error.value === null ? null : describeError(lexiconQuery.error.value)
)

const resetForm = () => {
  editingId.value = null
  title.value = ""
  presetKind.value = "explore"
  filterText.value = ""
  gate.value = "any"
  includeArchived.value = false
  keywordIds.value = []
  formError.value = null
}

const fillForm = (preset: PresetRecord) => {
  editingId.value = preset.id
  title.value = preset.title
  presetKind.value = preset.kind
  filterText.value = preset.filter.text ?? ""
  gate.value = preset.filter.gate ?? "any"
  includeArchived.value = preset.filter.includeArchived === true
  keywordIds.value = [...(preset.filter.keywordIds ?? [])]
  formError.value = null
  notice.value = null
  confirmDeleteId.value = null
}

const submit = async () => {
  const trimmedTitle = title.value.trim()
  if (trimmedTitle === "") {
    formError.value = "Введите название пресета."
    return
  }

  formError.value = null
  notice.value = null
  const wasEditing = editingId.value !== null

  try {
    await upsertMutation.mutateAsync({
      id: editingId.value ?? undefined,
      kind: presetKind.value === "apply" ? "apply" : "explore",
      title: trimmedTitle,
      filter: parsePresetFilter({
        text: filterText.value.trim(),
        gate: gate.value === "any" ? undefined : gate.value,
        keywordIds: keywordIds.value,
        includeArchived: includeArchived.value
      })
    })
    resetForm()
    notice.value = wasEditing ? "Пресет обновлён." : "Пресет создан."
  } catch {
    // The mutation error is rendered above the form.
  }
}

const remove = async (preset: PresetRecord) => {
  notice.value = null
  removingId.value = preset.id
  try {
    const result = await removeMutation.mutateAsync(preset.id)
    if (editingId.value === preset.id) resetForm()
    confirmDeleteId.value = null
    notice.value = result.deleted ? "Пресет удалён." : "Пресет не удалён: запись не найдена."
  } catch {
    // The mutation error is rendered above the form.
  } finally {
    removingId.value = null
  }
}

const columns: ColumnDef<PresetRecord>[] = [
  {
    accessorKey: "title",
    header: sortableHeader<PresetRecord>("Название"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[320px]" }, [
        h("div", { class: "font-medium" }, row.original.title),
        h("code", { class: "text-[11px] text-muted-foreground" }, row.original.id)
      ])
  },
  {
    id: "kind",
    accessorFn: (row) => presetKindLabel(row.kind),
    header: sortableHeader<PresetRecord>("Тип"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.kind === "apply" ? "info" : "secondary" },
        () => presetKindLabel(row.original.kind)
      )
  },
  {
    id: "system",
    accessorFn: (row) => (row.system ? "системный" : "пользовательский"),
    header: sortableHeader<PresetRecord>("Системный"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.system ? "outline" : "neutral" },
        () => (row.original.system ? "системный" : "пользовательский")
      )
  },
  {
    id: "filter",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Фильтр",
    cell: ({ row }) =>
      h("div", { class: "max-w-[420px]" }, [
        h("details", null, [
          h(
            "summary",
            { class: "cursor-pointer font-mono text-xs text-muted-foreground" },
            payloadPreview(row.original.filter)
          ),
          h(
            "pre",
            {
              class:
                "mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
            },
            payloadText(row.original.filter)
          )
        ])
      ])
  },
  {
    accessorKey: "updatedAt",
    header: sortableHeader<PresetRecord>("Обновлён"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.updatedAt)
      )
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) => {
      const preset = row.original
      if (preset.system) {
        return h("span", { class: "text-xs text-muted-foreground" }, "только чтение")
      }
      if (confirmDeleteId.value === preset.id) {
        return h("div", { class: "flex items-center gap-1.5" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Удалить?"),
          h(
            Button,
            {
              size: "sm",
              variant: "destructive",
              disabled: removingId.value === preset.id,
              onClick: () => void remove(preset)
            },
            () => (removingId.value === preset.id ? "Удаляем…" : "Да")
          ),
          h(
            Button,
            { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = null) },
            () => "Отмена"
          )
        ])
      }
      return h("div", { class: "flex items-center gap-1.5" }, [
        h(
          Button,
          {
            size: "sm",
            variant: "outline",
            onClick: () => fillForm(preset)
          },
          () => "Изменить"
        ),
        h(
          Button,
          { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = preset.id) },
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
      title="Пресеты"
      description="Сохранённые фильтры корпуса: что искать и по каким правилам откликаться."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить пресеты</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" variant="info" class="mb-4">
      <CircleAlert />
      <AlertTitle>Готово</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>{{ isEditing ? "Изменить пресет" : "Новый пресет" }}</CardTitle>
        <CardDescription>
          Пресет хранит фильтр корпуса. Системные пресеты доступны только для чтения;
          пользовательские можно менять и удалять.
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
            <AlertTitle>Не удалось сохранить пресет</AlertTitle>
            <AlertDescription>{{ writeErrorText }}</AlertDescription>
          </Alert>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2 md:col-span-2">
              <Label for="preset-title">Название</Label>
              <Input
                id="preset-title"
                v-model="title"
                type="text"
                placeholder="Например, Backend без архива"
                :disabled="upsertMutation.isLoading.value"
              />
            </div>

            <div class="space-y-2">
              <Label for="preset-kind">Тип</Label>
              <Select v-model="presetKind">
                <SelectTrigger id="preset-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="explore">Поиск (explore)</SelectItem>
                  <SelectItem value="apply">Отклики (apply)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label for="preset-gate">Гейт</Label>
              <Select v-model="gate">
                <SelectTrigger id="preset-gate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Любой вердикт</SelectItem>
                  <SelectItem value="match">Подходит (match)</SelectItem>
                  <SelectItem value="unknown">Неясно (unknown)</SelectItem>
                  <SelectItem value="reject">Отклонено (reject)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2 md:col-span-2">
              <Label for="preset-filter-text">Текст фильтра</Label>
              <Input
                id="preset-filter-text"
                v-model="filterText"
                type="text"
                placeholder="Подстрока названия вакансии"
                :disabled="upsertMutation.isLoading.value"
              />
              <p class="text-xs text-muted-foreground">
                Совпадение по названию вакансии без учёта регистра. Пустое поле не ограничивает.
              </p>
            </div>

            <div class="space-y-2 md:col-span-2">
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="includeArchived"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="upsertMutation.isLoading.value"
                />
                Включать архивные вакансии
              </Label>
            </div>

            <div class="md:col-span-2">
              <Alert v-if="lexiconErrorText" variant="warning" class="mb-2">
                <CircleAlert />
                <AlertTitle>Словарь недоступен</AlertTitle>
                <AlertDescription>{{ lexiconErrorText }}</AlertDescription>
              </Alert>
              <PresetKeywordPicker
                v-model="keywordIds"
                :keywords="lexicon"
                :loading="lexiconQuery.isPending.value"
                :disabled="upsertMutation.isLoading.value"
              />
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="upsertMutation.isLoading.value">
              {{ isEditing ? "Сохранить" : "Создать пресет" }}
            </Button>
            <Button
              v-if="isEditing"
              type="button"
              variant="outline"
              :disabled="upsertMutation.isLoading.value"
              @click="resetForm"
            >
              Отмена
            </Button>
            <span class="text-xs text-muted-foreground">
              После записи обновляются пресеты и счётчики ключевых слов.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>

    <DataTable
      :columns="columns"
      :data="presets"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="Название пресета"
      empty-title="Пресетов нет"
      empty-description="Создайте пресет в форме выше, чтобы фильтровать корпус и поток откликов."
    >
      <template #toolbar>
        <div class="space-y-1.5">
          <Label for="preset-kind-filter" class="text-xs text-muted-foreground">Тип</Label>
          <Select v-model="kind">
            <SelectTrigger id="preset-kind-filter" class="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              <SelectItem value="explore">Поиск (explore)</SelectItem>
              <SelectItem value="apply">Отклики (apply)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span class="pb-2 text-xs text-muted-foreground">Пресетов: {{ presets.length }}</span>
      </template>
    </DataTable>
  </section>
</template>
