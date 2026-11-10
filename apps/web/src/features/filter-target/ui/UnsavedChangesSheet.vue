<script setup lang="ts">
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui"

/** Вопрос «отбросить несохранённые правки?» при уходе со страницы или смене выбора. */
withDefaults(
  defineProps<{ open: boolean; description?: string; leaveLabel?: string }>(),
  { description: "Если уйти сейчас, правки пропадут.", leaveLabel: "Отбросить и уйти" }
)
const emit = defineEmits<{ leave: []; stay: [] }>()
</script>

<template>
  <Sheet :open="open" @update:open="(value) => !value && emit('stay')">
    <SheetContent side="bottom" class="mx-auto w-full gap-3 rounded-t-xl p-4 sm:max-w-md">
      <SheetHeader class="p-0">
        <SheetTitle>Есть несохранённые изменения</SheetTitle>
        <SheetDescription>{{ description }}</SheetDescription>
      </SheetHeader>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" @click="emit('leave')">{{ leaveLabel }}</Button>
        <Button autofocus @click="emit('stay')">Остаться и продолжить</Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
