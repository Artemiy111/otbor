<script setup lang="ts">
import { cn } from "@/shared/lib"

/** Переключатель «включено / выключено»; клавиатура: пробел и Enter. */
defineProps<{
  modelValue: boolean
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    :class="
      cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        modelValue ? 'bg-primary' : 'bg-input'
      )
    "
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      :class="
        cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow transition-transform',
          modelValue ? 'translate-x-4' : 'translate-x-0.5'
        )
      "
    />
  </button>
</template>
