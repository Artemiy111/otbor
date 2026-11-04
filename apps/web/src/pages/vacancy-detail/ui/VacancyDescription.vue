<script setup lang="ts">
import { computed, ref } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { Button, EmptyState } from "@/shared/ui"

const props = withDefaults(defineProps<{ data: VacancyDetail; collapsible?: boolean }>(), {
  collapsible: false
})
const highlight = ref(true)
const expanded = ref(!props.collapsible)

const html = computed(() => {
  const text = props.data.descriptionText
  if (text.trim() === "" || !highlight.value) return null
  const forms = [...new Set(props.data.keywords.map((item) => item.matchedForm).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  )
  if (forms.length === 0) return null
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const pattern = new RegExp(`(${forms.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu")
  return escaped.replace(
    pattern,
    (match) => `<mark class="rounded bg-amber-200/60 px-0.5 text-foreground dark:bg-amber-400/30">${match}</mark>`
  )
})
const box = computed(() => [
  "whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed",
  expanded.value ? "" : "max-h-72 overflow-hidden [mask-image:linear-gradient(#000_70%,transparent)]"
])
</script>

<template>
  <div v-if="data.descriptionText.trim() !== ''" class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <label class="flex items-center gap-2 text-xs text-muted-foreground">
        <input v-model="highlight" type="checkbox" class="size-4 rounded border-input accent-primary" />
        Подсветить ключевые слова
      </label>
      <Button v-if="collapsible" size="sm" variant="ghost" @click="expanded = !expanded">
        {{ expanded ? "Свернуть" : "Показать полностью" }}
      </Button>
    </div>
    <div v-if="html !== null" :class="box" v-html="html" />
    <div v-else :class="box">{{ data.descriptionText }}</div>
  </div>
  <EmptyState v-else title="Описание не разобрано" description="Нажмите «Догрузить» вверху страницы." />
</template>
