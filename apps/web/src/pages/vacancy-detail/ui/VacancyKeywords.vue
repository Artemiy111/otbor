<script setup lang="ts">
import { computed } from "vue"
import type { ResumeRecord, VacancyDetail } from "@otbor/contract"
import { makeResumeMatcher } from "@/shared/lib"

const props = defineProps<{ data: VacancyDetail; resume: ResumeRecord | null }>()

const groups = computed(() => {
  const map = new Map<
    string,
    { term: string; title: number; body: number; forms: Array<string> }
  >()
  for (const keyword of props.data.keywords) {
    const group = map.get(keyword.term) ?? { term: keyword.term, title: 0, body: 0, forms: [] }
    group.title += keyword.titleCount
    group.body += keyword.bodyCount
    if (!keyword.typo && !group.forms.includes(keyword.matchedForm)) group.forms.push(keyword.matchedForm)
    map.set(keyword.term, group)
  }
  const matches = makeResumeMatcher(props.resume)
  return [...map.values()]
    .map((group) => ({
      ...group,
      total: group.title + group.body,
      inResume: matches?.([group.term, ...group.forms]) ?? null
    }))
    .sort((a, b) => {
      const rank = (value: boolean | null) => (value === true ? 0 : 1)
      return rank(a.inResume) - rank(b.inResume) || b.total - a.total || a.term.localeCompare(b.term, "ru")
    })
})
const found = computed(() => groups.value.filter((group) => group.inResume === true).length)
const missingNames = computed(() =>
  groups.value.filter((group) => group.inResume === false && group.title > 0).map((group) => group.term)
)

const tooltip = (group: (typeof groups.value)[number]) =>
  [
    group.inResume === null ? null : group.inResume ? "Есть в выбранном резюме" : "В выбранном резюме не найдено",
    `в вакансии: ${group.total}${group.title > 0 ? " (есть в заголовке)" : ""}`,
    group.forms.length > 0 ? `формы: ${group.forms.join(", ")}` : null
  ]
    .filter(Boolean)
    .join(" · ")
</script>

<template>
  <div v-if="groups.length > 0" class="space-y-2">
    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="group in groups"
        :key="group.term"
        :title="tooltip(group)"
        class="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs"
        :class="
          group.inResume === null
            ? 'border-border bg-muted/40'
            : group.inResume
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-border text-muted-foreground'
        "
      >
        {{ group.term }}
        <span class="rounded-full bg-background/60 px-1.5 text-[10px] tabular-nums opacity-70">{{ group.total }}</span>
      </span>
    </div>
    <p v-if="resume" class="text-xs text-muted-foreground">
      <span class="text-emerald-300">Зелёные</span> есть в резюме «{{ resume.title }}»: {{ found }} из
      {{ groups.length }}. Число — сколько раз слово встречается в вакансии.
      <template v-if="missingNames.length > 0">
        Нет в резюме, но есть в заголовке: <b class="text-foreground">{{ missingNames.join(", ") }}</b>.
      </template>
    </p>
    <p v-else class="text-xs text-muted-foreground">Число — сколько раз слово встречается в вакансии.</p>
  </div>
  <p v-else class="text-sm text-muted-foreground">Словарь не нашёл ключевых слов в этой вакансии.</p>
</template>
