<script setup lang="ts">
import Button from "../button/Button.vue"
import Sheet from "../sheet/Sheet.vue"
import SheetContent from "../sheet/SheetContent.vue"
import SheetDescription from "../sheet/SheetDescription.vue"
import SheetHeader from "../sheet/SheetHeader.vue"
import SheetTitle from "../sheet/SheetTitle.vue"

/**
 * Подтверждение действия внизу экрана: что именно произойдёт и две кнопки.
 * Само действие выполняет владелец по событию `confirm`.
 */
withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel: string
    cancelLabel?: string
    busy?: boolean
    destructive?: boolean
  }>(),
  { description: undefined, cancelLabel: "Отмена", busy: false, destructive: false }
)
const emit = defineEmits<{ "update:open": [value: boolean]; confirm: [] }>()
</script>

<template>
  <Sheet :open="open" @update:open="(value) => emit('update:open', value)">
    <SheetContent side="bottom" class="mx-auto w-full gap-3 rounded-t-xl p-4 sm:max-w-lg">
      <SheetHeader class="p-0">
        <SheetTitle>{{ title }}</SheetTitle>
        <SheetDescription v-if="description">{{ description }}</SheetDescription>
      </SheetHeader>
      <slot />
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" @click="emit('update:open', false)">{{ cancelLabel }}</Button>
        <Button :variant="destructive ? 'destructive' : 'default'" :disabled="busy" @click="emit('confirm')">
          {{ confirmLabel }}
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
