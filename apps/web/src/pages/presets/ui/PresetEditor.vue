<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue"
import { useDebounceFn } from "@vueuse/core"
import type { PresetFilter, PresetKind, PresetPreview, PresetRecord } from "@otbor/contract"
import { CircleAlert, Save } from "@lucide/vue"
import { presetApi } from "@/entities/preset"
import { RuleBuilder, allRules, buildFilter, isComplete, toEditable } from "@/features/rule-builder"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input
} from "@/shared/ui"
import PresetPreviewPanel from "./PresetPreviewPanel.vue"

const props = withDefaults(
  defineProps<{
    preset: PresetRecord | null
    saving?: boolean
    error?: string | null
  }>(),
  { saving: false, error: null }
)

const emit = defineEmits<{
  save: [input: { title: string; kind: PresetKind; filter: PresetFilter }]
  cancel: []
}>()

const title = ref(props.preset?.title ?? "")
/** Legacy label, no behaviour behind it: kept as stored, "explore" for new presets. */
const kind: PresetKind = props.preset?.kind ?? "explore"
const filter = ref(reactive(toEditable(props.preset?.filter)))
const formError = ref<string | null>(null)

const incomplete = computed(() => allRules(filter.value).some((rule) => !isComplete(rule)))

const preview = ref<PresetPreview | null>(null)
const previewError = ref<string | null>(null)
const previewing = ref(false)

/** Live: every edit of a complete filter recounts after a short pause. */
const runPreview = async () => {
  previewing.value = true
  previewError.value = null
  try {
    preview.value = await presetApi.preview(buildFilter(filter.value))
  } catch (cause) {
    preview.value = null
    previewError.value = describeError(cause)
  } finally {
    previewing.value = false
  }
}
const schedulePreview = useDebounceFn(runPreview, 500)

watch(
  () => buildFilter(filter.value),
  () => void schedulePreview(),
  { deep: true }
)

const submit = () => {
  const trimmed = title.value.trim()
  if (trimmed === "") {
    formError.value = "Введите название пресета."
    return
  }
  formError.value = null
  emit("save", { title: trimmed, kind, filter: buildFilter(filter.value) })
}

onMounted(() => {
  void runPreview()
})
</script>

<template>
  <div class="space-y-3">
    <Card>
      <CardContent class="space-y-3 p-4">
        <Alert v-if="formError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Проверьте форму</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <Alert v-if="props.error" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось сохранить пресет</AlertTitle>
          <AlertDescription>{{ props.error }}</AlertDescription>
        </Alert>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="title"
            type="text"
            class="h-8 min-w-[220px] flex-1"
            placeholder="Название пресета"
            :disabled="props.saving"
            @keydown.enter="submit"
          />
        </div>

        <RuleBuilder v-model="filter" :disabled="props.saving" />

        <p
          v-if="filter.keywordIds !== undefined && filter.keywordIds.length > 0"
          class="text-[11px] text-muted-foreground"
        >
          Ограничение словаря ({{ filter.keywordIds.length }}) сохранено из старой версии и не влияет на срез.
        </p>

        <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" :disabled="props.saving" @click="submit">
            <Save class="h-4 w-4" />
            {{ props.saving ? "Сохраняю…" : "Сохранить" }}
          </Button>
          <Button variant="ghost" size="sm" :disabled="props.saving" @click="emit('cancel')">
            Отмена
          </Button>
          <span class="ml-auto text-xs text-muted-foreground">
            <template v-if="previewing">Считаю…</template>
            <template v-else-if="preview !== null">Найдено: <b class="text-foreground">{{ preview.count }}</b></template>
            <template v-if="incomplete"> · неполные правила не учитываются</template>
          </span>
        </div>
      </CardContent>
    </Card>

    <PresetPreviewPanel
      v-if="preview !== null || previewError !== null"
      :preview="preview"
      :loading="previewing"
      :error="previewError"
      hint="Срез обновляется при изменении правил"
    />
  </div>
</template>
