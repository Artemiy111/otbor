<script setup lang="ts">
import { ref } from "vue"
import { Button, type ButtonVariants } from "@/shared/ui"

/**
 * Действие в два шага: кнопка раскрывается в одну строку с пояснением, что
 * произойдёт и можно ли это отменить, и только вторая кнопка выполняет действие.
 */
withDefaults(
  defineProps<{
    label: string
    confirmLabel: string
    /** Одна строка: что случится и как это отменить. */
    hint: string
    variant?: ButtonVariants["variant"]
    size?: ButtonVariants["size"]
    /** Выполняется ли действие сейчас. */
    busy?: boolean
    disabled?: boolean
    /** Пояснение к необратимому действию красим предупреждением. */
    destructive?: boolean
  }>(),
  { variant: "outline", size: "sm", busy: false, disabled: false, destructive: false }
)

const emit = defineEmits<{ confirm: [] }>()
const open = ref(false)

const confirm = () => {
  open.value = false
  emit("confirm")
}
</script>

<template>
  <span v-if="open" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2">
    <span class="max-w-prose text-xs" :class="destructive ? 'text-warning' : 'text-muted-foreground'">{{ hint }}</span>
    <span class="flex items-center gap-1.5">
      <Button :size="size" :variant="destructive ? 'destructive' : 'default'" :disabled="busy || disabled" @click="confirm">
        {{ confirmLabel }}
      </Button>
      <Button :size="size" variant="ghost" @click="open = false">Отмена</Button>
    </span>
  </span>
  <Button v-else :size="size" :variant="variant" :disabled="busy || disabled" @click="open = true">
    <slot>{{ label }}</slot>
  </Button>
</template>
