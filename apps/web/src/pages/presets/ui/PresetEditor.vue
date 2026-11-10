<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue"
import { useDebounceFn, useEventListener } from "@vueuse/core"
import { parsePresetFilter } from "@otbor/contract"
import type { PresetFilter, PresetKind, PresetPreview, PresetRecord } from "@otbor/contract"
import { CircleAlert, Save } from "@lucide/vue"
import { presetApi } from "@/entities/preset"
import {
  NEW_PRESET_FILTER,
  RuleBuilder,
  allRules,
  buildFilter,
  isComplete,
  toEditable,
  FunnelSankey,
  funnelStages,
  useRuleFunnel
} from "@/features/rule-builder"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Textarea
} from "@/shared/ui"
import PresetPreviewPanel from "./PresetPreviewPanel.vue"

const props = withDefaults(
  defineProps<{
    preset: PresetRecord | null
    saving?: boolean
  }>(),
  { saving: false }
)

const emit = defineEmits<{
  save: [input: { title: string; kind: PresetKind; filter: PresetFilter }]
  cancel: []
}>()

const title = ref(props.preset?.title ?? "")
/** Legacy label, no behaviour behind it: kept as stored, "explore" for new presets. */
const kind: PresetKind = props.preset?.kind ?? "explore"
const filter = ref(reactive(toEditable(props.preset === null ? NEW_PRESET_FILTER : props.preset.filter)))
const formError = ref<string | null>(null)

/** "rules" is the builder; "json" shows and edits the very filter that is saved and sent to the server. */
const mode = ref<"rules" | "json">("rules")
const jsonText = ref("")
const jsonError = ref<string | null>(null)

const showJson = () => {
  jsonText.value = JSON.stringify(buildFilter(filter.value), null, 2)
  jsonError.value = null
  mode.value = "json"
}

const showRules = () => {
  if (jsonError.value !== null) return
  mode.value = "rules"
}

/** Each valid edit replaces the builder state, so the preview and Save always follow the text. */
const onJsonInput = (value: string | undefined) => {
  jsonText.value = value ?? ""
  try {
    filter.value = reactive(toEditable(parsePresetFilter(JSON.parse(jsonText.value))))
    jsonError.value = null
  } catch (cause) {
    jsonError.value = describeError(cause)
  }
}

const { counts: funnel, total: corpusTotal } = useRuleFunnel(filter)
const stages = computed(() => funnelStages(filter.value, funnel.value, corpusTotal.value))

/** Снимок сохранённого состояния: от него считается «есть несохранённые изменения». */
const snapshot = (): string => JSON.stringify([title.value.trim(), buildFilter(filter.value)])
const saved = ref(snapshot())
const dirty = computed(() => snapshot() !== saved.value)
const confirmDiscard = ref(false)

const requestCancel = () => {
  if (!dirty.value) return emit("cancel")
  confirmDiscard.value = true
}

useEventListener(window, "beforeunload", (event) => {
  if (dirty.value) event.preventDefault()
})
useEventListener(window, "keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault()
    if (!props.saving) submit()
  }
})

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
  if (jsonError.value !== null) {
    formError.value = "Исправьте JSON фильтра."
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

        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="title"
            type="text"
            class="h-10 min-w-[220px] flex-1 border-transparent bg-transparent px-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
            placeholder="Название пресета"
            autofocus
            :disabled="props.saving"
            @keydown.enter="submit"
          />
        </div>

        <div class="flex items-center gap-1">
          <Button size="sm" :variant="mode === 'rules' ? 'secondary' : 'ghost'" :disabled="jsonError !== null" @click="showRules">
            Правила
          </Button>
          <Button size="sm" :variant="mode === 'json' ? 'secondary' : 'ghost'" @click="showJson">JSON</Button>
        </div>

        <RuleBuilder v-if="mode === 'rules'" v-model="filter" :disabled="props.saving" :counts="funnel" />
        <div v-else class="space-y-1.5">
          <Textarea
            :model-value="jsonText"
            class="min-h-[320px] font-mono text-xs"
            spellcheck="false"
            :disabled="props.saving"
            @update:model-value="onJsonInput"
          />
          <p v-if="jsonError" class="text-xs text-destructive">{{ jsonError }}</p>
          <p v-else class="text-xs text-muted-foreground">
            Это фильтр, который сохраняется. Неполные правила при разборе отбрасываются.
          </p>
        </div>

        <p
          v-if="filter.keywordIds !== undefined && filter.keywordIds.length > 0"
          class="text-xs text-muted-foreground"
        >
          Ограничение словаря ({{ filter.keywordIds.length }}) сохранено из старой версии и не влияет на срез.
        </p>

        <div v-if="mode === 'rules' && stages.length > 1" class="space-y-1 border-t border-border pt-3">
          <h3 class="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Воронка: как правила сужают корпус
          </h3>
          <FunnelSankey :stages="stages" />
        </div>

        <div
          class="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center gap-2 rounded-b-xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur"
        >
          <template v-if="confirmDiscard">
            <span class="text-xs text-muted-foreground">Отбросить несохранённые изменения?</span>
            <Button size="sm" variant="destructive" @click="emit('cancel')">Отбросить</Button>
            <Button size="sm" variant="ghost" @click="confirmDiscard = false">Продолжить правку</Button>
          </template>
          <template v-else>
            <Button size="sm" :disabled="props.saving || (!dirty && props.preset !== null)" @click="submit">
              <Save class="h-4 w-4" />
              {{ props.saving ? "Сохраняю…" : "Сохранить" }}
              <kbd class="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-xs font-normal opacity-70 sm:inline">⌘S</kbd>
            </Button>
            <Button variant="ghost" size="sm" :disabled="props.saving" @click="requestCancel">
              Отмена
            </Button>
            <span v-if="dirty" class="flex items-center gap-1 text-xs text-warning">
              <span class="size-1.5 rounded-full bg-current" />
              не сохранено
            </span>
          </template>
          <span class="ml-auto text-xs text-muted-foreground">
            <template v-if="previewing">Считаю…</template>
            <template v-else-if="preview !== null">
              Найдено: <b class="text-base text-foreground tabular-nums">{{ preview.count.toLocaleString("ru-RU") }}</b>
            </template>
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
