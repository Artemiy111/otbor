<script setup lang="ts">
import { CircleAlert } from "@lucide/vue"
import { Alert, AlertDescription, AlertTitle, Button, Input, Label } from "@/shared/ui"
import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "@/entities/schedule"

/**
 * Общая часть всех форм расписаний: интервал, переключатель «включено»,
 * сообщение об ошибке и кнопки. Поля вида подставляются в слот.
 */
defineProps<{
  saving: boolean
  error: string | null
  submitLabel: string
  /** Подпись переключателя, например «Поиск включён». */
  enabledLabel?: string
}>()

const interval = defineModel<string>("interval", { required: true })
const enabled = defineModel<boolean>("enabled", { required: true })

defineEmits<{ submit: []; cancel: [] }>()
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="$emit('submit')">
    <Alert v-if="error" variant="destructive">
      <CircleAlert />
      <AlertTitle>Проверьте форму</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <slot />

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="schedule-interval">Как часто, минуты</Label>
        <Input
          id="schedule-interval"
          v-model="interval"
          type="number"
          inputmode="numeric"
          :min="MIN_INTERVAL_MINUTES"
          :max="MAX_INTERVAL_MINUTES"
          step="1"
          class="tabular-nums"
          :disabled="saving"
        />
        <p class="text-xs text-muted-foreground">Не реже чем раз в {{ MIN_INTERVAL_MINUTES }} минут.</p>
      </div>
      <div class="flex items-end pb-1">
        <Label class="flex items-center gap-2 font-normal">
          <input
            v-model="enabled"
            type="checkbox"
            class="size-4 rounded border-input accent-primary"
            :disabled="saving"
          />
          {{ enabledLabel ?? "Расписание включено" }}
        </Label>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit" :disabled="saving">{{ saving ? "Сохраняем…" : submitLabel }}</Button>
      <Button type="button" variant="outline" :disabled="saving" @click="$emit('cancel')">Отмена</Button>
    </div>
  </form>
</template>
