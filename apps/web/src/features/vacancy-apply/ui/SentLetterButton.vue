<script setup lang="ts">
import { ref } from "vue"
import { Mail } from "@lucide/vue"
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui"
import { useLetterStatus } from "../model"

/** "Письмо" with the text of the cover letter that went to hh. Renders nothing until one was sent. */
const props = defineProps<{ vacancyId: string; accountId: string; label?: boolean }>()
const { status, sent } = useLetterStatus(
  () => props.vacancyId,
  () => props.accountId
)
const open = ref(false)
</script>

<template>
  <template v-if="sent">
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 px-1.5 text-xs"
      title="Показать отправленное письмо"
      @click.prevent.stop="open = true"
    >
      <Mail class="size-3.5 text-emerald-600" />
      <template v-if="label">Письмо</template>
    </Button>
    <Sheet v-model:open="open">
      <SheetContent side="right" class="w-full overflow-y-auto p-4 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Отправленное письмо</SheetTitle>
          <SheetDescription>Текст, который ушёл на hh вместе с откликом.</SheetDescription>
        </SheetHeader>
        <p class="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{{ status?.letter }}</p>
      </SheetContent>
    </Sheet>
  </template>
</template>
