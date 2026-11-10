<script setup lang="ts">
import { computed, ref } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { termsPattern } from "@otbor/domain"
import { EmptyState } from "@/shared/ui"
import { descriptionBlocks } from "../lib"

/** Описание как основной текст для чтения: узкая колонка, заголовки и списки, ключевые слова подсвечены. */
const props = defineProps<{ data: VacancyDetail }>()
const highlight = ref(true)

const blocks = computed(() => descriptionBlocks(props.data.descriptionText))
const pattern = computed(() =>
  highlight.value ? termsPattern(props.data.keywords.map((item) => item.matchedForm)) : null
)

/** Экранирует текст и оборачивает найденные слова в <mark>; HTML из вакансии не попадает на страницу. */
const mark = (text: string): string => {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const found = pattern.value
  return found === null
    ? escaped
    : escaped.replace(found, (match) => `<mark class="rounded-sm bg-warning-muted px-0.5 text-foreground">${match}</mark>`)
}
</script>

<template>
  <div v-if="blocks.length > 0" class="space-y-3">
    <label class="flex w-fit items-center gap-2 text-xs text-muted-foreground">
      <input v-model="highlight" type="checkbox" class="size-4 rounded border-input accent-primary" />
      Подсветить ключевые слова
    </label>
    <div class="max-w-[72ch] space-y-3 text-base leading-7 text-pretty break-words">
      <template v-for="(block, index) in blocks" :key="index">
        <h3 v-if="block.kind === 'heading'" class="pt-3 text-base font-semibold" v-html="mark(block.text)" />
        <ul v-else-if="block.kind === 'list'" class="list-disc space-y-1 pl-5 marker:text-muted-foreground">
          <li v-for="(item, itemIndex) in block.items" :key="itemIndex" v-html="mark(item)" />
        </ul>
        <p v-else v-html="mark(block.text)" />
      </template>
    </div>
  </div>
  <EmptyState v-else title="Описание ещё не загружено" description="Откройте меню «⋯» вверху страницы и выберите «Заново загрузить с hh»." />
</template>
