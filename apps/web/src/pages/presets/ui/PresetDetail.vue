<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { PresetRecord } from "@otbor/contract"
import { Copy, Pencil, Trash2 } from "@lucide/vue"
import { presetApi, presetKeys } from "@/entities/preset"
import { describeError, formatDate } from "@/shared/lib"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/shared/ui"
import PresetPreviewPanel from "./PresetPreviewPanel.vue"
import {
  FunnelSankey,
  PRESET_LOCATION_LABELS,
  describePresetRule,
  funnelStages,
  toEditable,
  useRuleFunnel
} from "@/features/rule-builder"
import { presetRules } from "@/features/rule-builder"

const props = withDefaults(
  defineProps<{
    preset: PresetRecord
    removing?: boolean
  }>(),
  { removing: false }
)

const emit = defineEmits<{ edit: []; remove: []; duplicate: [] }>()

const rules = computed(() => presetRules(props.preset.filter))
const groups = computed(() => props.preset.filter.groups ?? [])
const confirmDelete = ref(false)

const previewQuery = useQuery({
  key: () => presetKeys.preview(props.preset.filter),
  query: () => presetApi.preview(props.preset.filter)
})

const editable = computed(() => toEditable(props.preset.filter))
const { counts: funnel, total: corpusTotal } = useRuleFunnel(editable)
const stages = computed(() => funnelStages(editable.value, funnel.value, corpusTotal.value))

const preview = computed(() => previewQuery.data.value ?? null)
const previewError = computed(() =>
  previewQuery.error.value === null ? null : describeError(previewQuery.error.value)
)
const locationLabel = computed(() => {
  const location = props.preset.filter.location
  return location === undefined ? null : PRESET_LOCATION_LABELS[location]
})
const keywordCount = computed(() => props.preset.filter.keywordIds?.length ?? 0)
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader class="gap-2 pb-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <CardTitle class="text-lg">{{ props.preset.title }}</CardTitle>
              <Badge variant="outline">
                {{ props.preset.system ? "системный" : "пользовательский" }}
              </Badge>
            </div>
            <CardDescription class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>обновлён {{ formatDate(props.preset.updatedAt) }}</span>
              <span>правил: {{ rules.length + groups.length }}</span>
              <span v-if="locationLabel">словарь: {{ locationLabel }}</span>
              <span
                v-if="keywordCount > 0"
                title="Ограничивает список ключевых слов, но не срез вакансий"
              >
                узкий словарь: {{ keywordCount }}
              </span>
            </CardDescription>
          </div>

          <div v-if="props.preset.system" class="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" @click="emit('duplicate')">
              <Copy class="h-3.5 w-3.5" />
              Сделать копию
            </Button>
          </div>

          <div
            v-else
            class="flex shrink-0 flex-wrap items-center gap-2"
          >
            <template v-if="confirmDelete">
              <span class="text-xs text-muted-foreground">Удалить пресет?</span>
              <Button
                size="sm"
                variant="destructive"
                :disabled="props.removing"
                @click="emit('remove')"
              >
                {{ props.removing ? "Удаляем…" : "Да" }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                :disabled="props.removing"
                @click="confirmDelete = false"
              >
                Отмена
              </Button>
            </template>
            <template v-else>
              <Button size="sm" variant="outline" @click="emit('edit')">
                <Pencil class="h-3.5 w-3.5" />
                Изменить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="text-muted-foreground"
                @click="confirmDelete = true"
              >
                <Trash2 class="h-3.5 w-3.5" />
                Удалить
              </Button>
            </template>
          </div>
        </div>
      </CardHeader>

      <CardContent class="space-y-2 border-t border-border pt-4">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Правила
          </h3>
          <span class="text-xs tabular-nums text-muted-foreground">{{ rules.length + groups.length }}</span>
        </div>

        <div v-if="rules.length > 0 || groups.length > 0" class="space-y-1">
          <div v-for="(rule, index) in rules" :key="index" class="flex gap-2 text-sm">
            <span class="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {{ index + 1 }}.
            </span>
            <span class="min-w-0 break-words">{{ describePresetRule(rule) }}</span>
          </div>
          <div
            v-for="(group, gi) in groups"
            :key="`g${gi}`"
            class="mt-1 rounded-md border border-l-2 border-l-ai/70 bg-muted/20 p-2 text-sm"
          >
            <p class="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Любой из вариантов
            </p>
            <template v-for="(branch, bi) in group.branches" :key="bi">
              <p v-if="bi > 0" class="my-0.5 text-xs font-bold uppercase text-muted-foreground">или</p>
              <p v-for="(rule, ri) in branch.rules" :key="ri" class="break-words">
                <span v-if="ri > 0" class="text-muted-foreground">и </span>{{ describePresetRule(rule) }}
              </p>
            </template>
          </div>
        </div>
        <p v-else class="text-xs text-muted-foreground">
          Правил нет — пресет выбирает весь корпус.
        </p>

        <p class="text-xs text-muted-foreground">
          Правила объединяются через «и», внутри группы варианты через «или».
          <template v-if="props.preset.system">Системный пресет общий и доступен только для чтения: сделайте копию, чтобы изменить правила.</template>
        </p>
      </CardContent>
    </Card>

    <Card v-if="stages.length > 1">
      <CardHeader class="gap-1 pb-2">
        <CardTitle class="text-base">Воронка</CardTitle>
        <CardDescription>Как правила по порядку сужают корпус</CardDescription>
      </CardHeader>
      <CardContent class="border-t border-border pt-3">
        <FunnelSankey :stages="stages" />
      </CardContent>
    </Card>

    <PresetPreviewPanel
      :preview="preview"
      :loading="previewQuery.isPending.value"
      :error="previewError"
      hint="Срез по сохранённым правилам"
    />
  </div>
</template>
