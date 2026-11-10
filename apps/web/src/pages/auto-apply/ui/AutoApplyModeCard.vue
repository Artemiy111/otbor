<script setup lang="ts">
import { computed } from "vue"
import type { ApplyUsage, AutoMode } from "@otbor/contract"
import { Check } from "@lucide/vue"
import { autoModeOptions } from "@/entities/apply-filter"
import { autoModeTone } from "@/entities/auto-apply"
import { cn, formatDate, toneClasses } from "@/shared/lib"
import { Card, CardContent, HelpHint, Skeleton } from "@/shared/ui"
import { autoApplyHelp } from "../model/help"

/** Главный переключатель: что система делает с откликами сама. Черновик режима, сохраняется общей кнопкой. */
const props = defineProps<{
  modelValue: AutoMode
  storedMode: AutoMode
  usage: ApplyUsage | null
  usageLoading: boolean
  disabled: boolean
}>()
const emit = defineEmits<{ "update:modelValue": [mode: AutoMode] }>()

const pending = computed(() => props.modelValue !== props.storedMode)

const percent = computed(() => {
  const usage = props.usage
  if (usage === null || usage.limit <= 0) return 0
  return Math.min(100, Math.round((usage.used / usage.limit) * 100))
})
const barClass = computed(() => (percent.value >= 90 ? toneClasses("warning").dot : "bg-primary"))

/** Первый слот освободится через сутки после самого раннего учтённого отклика. */
const freesAt = computed(() => {
  const oldest = props.usage?.oldest
  if (oldest === null || oldest === undefined) return null
  const time = Date.parse(oldest)
  return Number.isNaN(time) ? null : formatDate(new Date(time + 24 * 3600 * 1000).toISOString())
})
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
    <fieldset :disabled="disabled" class="min-w-0 space-y-2">
      <legend class="mb-2 flex items-center gap-1 text-sm font-semibold">
        Режим
        <HelpHint :text="autoApplyHelp.mode" label="режимы автооткликов" />
      </legend>
      <div class="grid gap-3 sm:grid-cols-3">
        <label
          v-for="option in autoModeOptions"
          :key="option.value"
          class="relative block cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        >
          <input
            type="radio"
            name="auto-mode"
            class="peer sr-only"
            :value="option.value"
            :checked="modelValue === option.value"
            @change="emit('update:modelValue', option.value)"
          />
          <span
            :class="
              cn(
                'flex h-full flex-col gap-1.5 rounded-xl border p-4 transition-colors',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                modelValue === option.value
                  ? cn(toneClasses(autoModeTone(option.value)).border, toneClasses(autoModeTone(option.value)).bg, 'shadow-sm')
                  : 'border-border bg-card hover:bg-accent'
              )
            "
          >
            <span class="flex items-center gap-2">
              <span
                :class="cn('size-2.5 shrink-0 rounded-full', toneClasses(autoModeTone(option.value)).dot)"
                aria-hidden="true"
              />
              <span class="text-base font-semibold" :class="modelValue === option.value ? toneClasses(autoModeTone(option.value)).text : ''">
                {{ option.label }}
              </span>
              <Check v-if="modelValue === option.value" class="ml-auto size-4" :class="toneClasses(autoModeTone(option.value)).text" aria-hidden="true" />
            </span>
            <span class="text-sm text-muted-foreground">{{ option.consequence }}</span>
            <span v-if="storedMode === option.value" class="text-xs text-muted-foreground">Сейчас включён</span>
          </span>
        </label>
      </div>
      <p v-if="pending && modelValue === 'auto'" class="text-xs text-muted-foreground">
        Авто включится после сохранения: перед этим попросим подтвердить.
      </p>
      <p v-else-if="pending" class="text-xs text-muted-foreground">Режим сменится после сохранения.</p>
    </fieldset>

    <Card class="self-start">
      <CardContent class="space-y-2 p-4">
        <div class="flex items-center gap-1 text-sm font-semibold">
          Сегодня отправлено
          <HelpHint :text="autoApplyHelp.budget" label="дневной лимит" />
        </div>
        <Skeleton v-if="usageLoading && usage === null" class="h-8 w-full" />
        <template v-else-if="usage">
          <p class="text-2xl font-semibold tabular-nums leading-none">
            {{ usage.used }} <span class="text-base font-normal text-muted-foreground">из {{ usage.limit }}</span>
          </p>
          <div
            class="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Использовано из дневного лимита"
            :aria-valuenow="usage.used"
            aria-valuemin="0"
            :aria-valuemax="usage.limit"
          >
            <div class="h-full rounded-full transition-all" :class="barClass" :style="{ width: `${percent}%` }" />
          </div>
          <p class="text-xs text-muted-foreground">
            Осталось {{ usage.remaining }}<template v-if="freesAt">. Первое место освободится {{ freesAt }}</template>
          </p>
        </template>
        <p v-else class="text-sm text-muted-foreground">Нет данных.</p>
      </CardContent>
    </Card>
  </div>
</template>
