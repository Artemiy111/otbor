<script setup lang="ts">
import { computed } from "vue"
import type { ResumeRecord, VacancyDetail } from "@otbor/contract"
import { makeResumeMatcher } from "@/shared/lib"

const props = defineProps<{ data: VacancyDetail; resume: ResumeRecord | null }>()

const items = computed(() => {
  const matches = makeResumeMatcher(props.resume)
  return props.data.skills.map((skill) => ({ skill, inResume: matches?.([skill]) ?? null }))
})
const found = computed(() => items.value.filter((item) => item.inResume === true).length)
</script>

<template>
  <div v-if="items.length > 0" class="space-y-2">
    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="item in items"
        :key="item.skill"
        class="rounded-full border px-2.5 py-0.5 text-xs"
        :class="
          item.inResume === null
            ? 'border-border bg-muted/40'
            : item.inResume
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-border text-muted-foreground'
        "
        :title="item.inResume === null ? undefined : item.inResume ? 'Есть в выбранном резюме' : 'В выбранном резюме не найдено'"
      >
        {{ item.skill }}
      </span>
    </div>
    <p v-if="resume" class="text-xs text-muted-foreground">
      <span class="text-emerald-300">Зелёные</span> есть в резюме «{{ resume.title }}»: {{ found }} из {{ items.length }}.
    </p>
  </div>
  <p v-else class="text-sm text-muted-foreground">Навыки в вакансии не указаны.</p>
</template>
