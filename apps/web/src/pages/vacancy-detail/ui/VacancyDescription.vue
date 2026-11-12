<script setup lang="ts">
import { computed, ref } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { termsPattern } from "@otbor/domain"
import { Inbox, LoaderCircle } from "@lucide/vue"
import { Button } from "@/shared/ui"
import { descriptionBlocks } from "../lib"
import type { VacancyPage } from "../model"

/** Описание как основной текст для чтения: узкая колонка, заголовки и списки, ключевые слова подсвечены. */
const props = defineProps<{ data: VacancyDetail; page: VacancyPage }>()
const highlight = ref(true)

const blocks = computed(() => descriptionBlocks(props.data.descriptionText ?? ""))
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
  <!-- Пустое описание: что говорить, зависит от догрузки, иначе шапка и блок противоречат друг другу. -->
  <div
    v-else-if="page.descriptionState.value === 'loading'"
    class="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground"
    role="status"
  >
    <LoaderCircle class="size-4 shrink-0 animate-spin" />
    Описание загружается, появится здесь само.
  </div>
  <div
    v-else-if="page.descriptionState.value === 'failed'"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-warning/30 bg-warning-muted px-4 py-4 text-sm"
    role="status"
  >
    <span class="text-warning">Описание не удалось загрузить: hh не ответил или страница не открылась.</span>
    <Button variant="outline" size="sm" @click="page.hydrate">Повторить</Button>
  </div>
  <div v-else class="flex items-start gap-3 rounded-lg border border-dashed border-border px-4 py-4 text-sm">
    <Inbox class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div class="space-y-0.5">
      <p class="font-medium">Описание ещё не загружено</p>
      <p class="text-muted-foreground">Откройте меню «⋯» вверху страницы и выберите «Заново загрузить с hh».</p>
    </div>
  </div>
</template>
