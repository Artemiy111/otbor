<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { PresetRecord } from "@otbor/contract"
import { CircleAlert, Pencil, Trash2 } from "@lucide/vue"
import { presetApi, presetKeys } from "@/entities/preset"
import { describeError, formatDate, presetKindLabel } from "@/shared/lib"
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
  CardTitle
} from "@/shared/ui"
import PresetPreviewPanel from "./PresetPreviewPanel.vue"
import {
  PRESET_LOCATION_LABELS,
  describePresetRule
} from "../model/fields"
import { presetRules } from "../model/rules"

const props = withDefaults(
  defineProps<{
    preset: PresetRecord
    removing?: boolean
    error?: string | null
  }>(),
  { removing: false, error: null }
)

const emit = defineEmits<{ edit: []; remove: [] }>()

const rules = computed(() => presetRules(props.preset.filter))
const confirmDelete = ref(false)

const previewQuery = useQuery({
  key: () => presetKeys.preview(props.preset.filter),
  query: () => presetApi.preview(props.preset.filter)
})

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
              <Badge :variant="props.preset.kind === 'apply' ? 'info' : 'secondary'">
                {{ presetKindLabel(props.preset.kind) }}
              </Badge>
              <Badge variant="outline">
                {{ props.preset.system ? "системный" : "пользовательский" }}
              </Badge>
            </div>
            <CardDescription class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>обновлён {{ formatDate(props.preset.updatedAt) }}</span>
              <span>правил: {{ rules.length }}</span>
              <span v-if="props.preset.filter.includeArchived">архивные включены</span>
              <span v-if="locationLabel">словарь: {{ locationLabel }}</span>
              <span
                v-if="keywordCount > 0"
                title="Ограничивает список ключевых слов, но не срез вакансий"
              >
                узкий словарь: {{ keywordCount }}
              </span>
            </CardDescription>
          </div>

          <div
            v-if="!props.preset.system"
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
          <h3 class="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Правила
          </h3>
          <span class="text-[11px] tabular-nums text-muted-foreground">{{ rules.length }}</span>
        </div>

        <div v-if="rules.length > 0" class="space-y-1">
          <div v-for="(rule, index) in rules" :key="index" class="flex gap-2 text-sm">
            <span class="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {{ index + 1 }}.
            </span>
            <span class="min-w-0 break-words">{{ describePresetRule(rule) }}</span>
          </div>
        </div>
        <p v-else class="text-xs text-muted-foreground">
          Правил нет — пресет выбирает весь корпус.
        </p>

        <p class="text-[11px] text-muted-foreground">
          Все правила объединяются через «и».
          <template v-if="props.preset.system">Системный пресет доступен только для чтения.</template>
        </p>
      </CardContent>
    </Card>

    <Alert v-if="props.error" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось удалить пресет</AlertTitle>
      <AlertDescription>{{ props.error }}</AlertDescription>
    </Alert>

    <PresetPreviewPanel
      :preview="preview"
      :loading="previewQuery.isPending.value"
      :error="previewError"
      hint="Срез по сохранённым правилам"
    />
  </div>
</template>
