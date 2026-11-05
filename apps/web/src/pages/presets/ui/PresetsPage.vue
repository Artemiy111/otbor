<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { PresetFilter, PresetKind, PresetRecord } from "@otbor/contract"
import { CircleAlert, Plus } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import {
  presetApi,
  presetKeys,
  type PresetUpsertInput
} from "@/entities/preset"
import { RefreshButton } from "@/features/refresh-button"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyState
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import PresetDetail from "./PresetDetail.vue"
import PresetEditor from "./PresetEditor.vue"
import PresetList from "./PresetList.vue"

const queryCache = useQueryCache()

const query = useQuery({
  key: () => presetKeys.list("all"),
  query: () => presetApi.list({})
})

const presets = computed<ReadonlyArray<PresetRecord>>(() => query.data.value ?? [])

/** `"new"` while creating, an id while editing, null while viewing. */
const editing = ref<"new" | string | null>(null)
const selectedId = ref<string | null>(null)
const notice = ref<string | null>(null)
const removingId = ref<string | null>(null)

const selected = computed(
  () => presets.value.find((preset) => preset.id === selectedId.value) ?? null
)

const editingPreset = computed(() =>
  editing.value !== null && editing.value !== "new"
    ? (presets.value.find((preset) => preset.id === editing.value) ?? null)
    : null
)

const editorOpen = computed(() => editing.value === "new" || editingPreset.value !== null)

const listError = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

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

const upsertError = computed(() =>
  upsertMutation.error.value === null
    ? null
    : describeError(upsertMutation.error.value)
)

const removeError = computed(() =>
  removeMutation.error.value === null
    ? null
    : describeError(removeMutation.error.value)
)

/**
 * The list owns selection: a deleted row clears it, and the first preset opens
 * by itself so the right column is never blank on a fresh visit.
 */
watch(
  presets,
  (items) => {
    if (
      editing.value !== null &&
      editing.value !== "new" &&
      !items.some((preset) => preset.id === editing.value)
    ) {
      editing.value = null
    }
    if (
      selectedId.value !== null &&
      !items.some((preset) => preset.id === selectedId.value)
    ) {
      selectedId.value = null
    }
    if (selectedId.value === null && editing.value === null && items.length > 0) {
      selectedId.value = items[0]!.id
    }
  },
  { immediate: true }
)

const selectPreset = (id: string) => {
  selectedId.value = id
  editing.value = null
  upsertMutation.reset()
  removeMutation.reset()
  notice.value = null
}

const startCreate = () => {
  editing.value = "new"
  upsertMutation.reset()
  removeMutation.reset()
  notice.value = null
}

const startEdit = () => {
  if (selected.value === null || selected.value.system) return
  editing.value = selected.value.id
  upsertMutation.reset()
  notice.value = null
}

/** A system preset is shared and read-only; a copy is the user's own and editable. */
const duplicate = async () => {
  const source = selected.value
  if (source === null) return
  notice.value = null
  try {
    const saved = await upsertMutation.mutateAsync({
      kind: source.kind,
      title: `${source.title} (копия)`,
      filter: source.filter
    })
    selectedId.value = saved.id
    editing.value = saved.id
    notice.value = "Копия создана, можно менять правила."
  } catch {
    // The mutation error is rendered inside the editor.
  }
}

const cancelEdit = () => {
  editing.value = null
  upsertMutation.reset()
}

const save = async (input: {
  title: string
  kind: PresetKind
  filter: PresetFilter
}) => {
  notice.value = null
  const wasEditing = editingPreset.value !== null
  try {
    const saved = await upsertMutation.mutateAsync({
      id: editingPreset.value?.id,
      kind: input.kind,
      title: input.title,
      filter: input.filter
    })
    editing.value = null
    selectedId.value = saved.id
    notice.value = wasEditing ? "Пресет обновлён." : "Пресет создан."
  } catch {
    // The mutation error is rendered inside the editor.
  }
}

const remove = async () => {
  const preset = selected.value
  if (preset === null || preset.system) return
  notice.value = null
  removingId.value = preset.id
  try {
    const result = await removeMutation.mutateAsync(preset.id)
    if (editing.value === preset.id) editing.value = null
    selectedId.value = null
    notice.value = result.deleted
      ? "Пресет удалён."
      : "Пресет не удалён: запись не найдена."
  } catch {
    // The mutation error is rendered above the detail card.
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <section>
    <PageHeader
      title="Пресеты"
      description="Сохранённые фильтры корпуса: что искать и по каким правилам откликаться."
    >
      <template #actions>
        <Button size="sm" @click="startCreate">
          <Plus class="h-4 w-4" />
          Новый пресет
        </Button>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="listError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить пресеты</AlertTitle>
      <AlertDescription>{{ listError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" variant="info" class="mb-4">
      <CircleAlert />
      <AlertTitle>Готово</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <div class="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <div class="min-w-0 lg:sticky lg:top-4">
        <PresetList
          :presets="presets"
          :selected-id="selectedId"
          :loading="query.isPending.value"
          @select="selectPreset"
        />
      </div>

      <div class="min-w-0">
        <PresetEditor
          v-if="editorOpen"
          :key="editing === 'new' ? 'new' : (editing ?? 'new')"
          :preset="editingPreset"
          :saving="upsertMutation.isLoading.value"
          :error="upsertError"
          @save="save"
          @cancel="cancelEdit"
        />

        <PresetDetail
          v-else-if="selected"
          :key="selected.id"
          :preset="selected"
          :removing="removingId === selected.id"
          :error="removeError"
          @edit="startEdit"
          @remove="remove"
          @duplicate="duplicate"
        />

        <EmptyState
          v-else-if="presets.length === 0"
          title="Пресетов нет"
          description="Создайте пресет, чтобы фильтровать корпус и поток откликов."
        >
          <Button size="sm" class="mt-2" @click="startCreate">
            <Plus class="h-4 w-4" />
            Новый пресет
          </Button>
        </EmptyState>

        <EmptyState
          v-else
          title="Выберите пресет"
          description="Слева — системные и ваши пресеты. Детали и предпросмотр появятся здесь."
        />
      </div>
    </div>
  </section>
</template>
