<script setup lang="ts">
import { computed } from "vue"
import { Check } from "@lucide/vue"
import type { ResumeRecord, VacancyDetail } from "@otbor/contract"
import { cn, makeResumeMatcher, toneClasses } from "@/shared/lib"
import { Hint } from "@/shared/ui"

/** Навыки и ключевые слова: найденные в резюме выделены, остальные приглушены. */
const props = defineProps<{ data: VacancyDetail; resume: ResumeRecord | null }>()

const matches = computed(() => makeResumeMatcher(props.resume))
const skills = computed(() =>
  props.data.skills.map((skill) => ({ skill, inResume: matches.value?.([skill]) ?? null }))
)
const keywords = computed(() => {
  const map = new Map<string, { term: string; title: number; body: number; forms: Array<string> }>()
  for (const keyword of props.data.keywords) {
    const group = map.get(keyword.term) ?? { term: keyword.term, title: 0, body: 0, forms: [] }
    group.title += keyword.titleCount
    group.body += keyword.bodyCount
    if (!keyword.typo && !group.forms.includes(keyword.matchedForm)) group.forms.push(keyword.matchedForm)
    map.set(keyword.term, group)
  }
  const rank = (value: boolean | null) => (value === true ? 0 : 1)
  return [...map.values()]
    .map((group) => ({
      ...group,
      total: group.title + group.body,
      inResume: matches.value?.([group.term, ...group.forms]) ?? null
    }))
    .toSorted((a, b) => rank(a.inResume) - rank(b.inResume) || b.total - a.total || a.term.localeCompare(b.term, "ru"))
})
const skillsFound = computed(() => skills.value.filter((item) => item.inResume === true).length)
const keywordsFound = computed(() => keywords.value.filter((item) => item.inResume === true).length)
const missingInTitle = computed(() =>
  keywords.value.filter((item) => item.inResume === false && item.title > 0).map((item) => item.term)
)

const chip = (inResume: boolean | null) =>
  cn(
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm",
    inResume === true ? toneClasses("success").badge : "border-border text-muted-foreground"
  )
</script>

<template>
  <section v-if="skills.length > 0 || keywords.length > 0" class="space-y-4" aria-labelledby="skills-title">
    <h2 id="skills-title" class="text-lg font-semibold">Навыки и ключевые слова</h2>

    <div v-if="skills.length > 0" class="space-y-2">
      <h3 class="text-sm font-medium text-muted-foreground">
        Навыки из вакансии<template v-if="resume"> · в резюме есть {{ skillsFound }} из {{ skills.length }}</template>
      </h3>
      <ul class="flex flex-wrap gap-1.5">
        <li v-for="item in skills" :key="item.skill">
          <Hint :text="item.inResume === null ? null : item.inResume ? 'Есть в выбранном резюме' : 'В выбранном резюме не найдено'">
            <span :class="chip(item.inResume)">
              <Check v-if="item.inResume" class="size-3.5" aria-label="есть в резюме" />
              {{ item.skill }}
            </span>
          </Hint>
        </li>
      </ul>
    </div>

    <div v-if="keywords.length > 0" class="space-y-2">
      <h3 class="text-sm font-medium text-muted-foreground">
        Ключевые слова текста<template v-if="resume"> · в резюме есть {{ keywordsFound }} из {{ keywords.length }}</template>
      </h3>
      <ul class="flex flex-wrap gap-1.5">
        <li v-for="item in keywords" :key="item.term">
          <Hint
            :text="[
              item.inResume === null ? null : item.inResume ? 'Есть в выбранном резюме' : 'В выбранном резюме не найдено',
              `Упоминаний: ${item.total}${item.title > 0 ? ' (есть в заголовке)' : ''}`
            ].filter(Boolean).join('\n')"
          >
            <span :class="chip(item.inResume)">
              <Check v-if="item.inResume" class="size-3.5" aria-label="есть в резюме" />
              {{ item.term }}
              <span class="text-xs tabular-nums opacity-70">{{ item.total }}</span>
            </span>
          </Hint>
        </li>
      </ul>
      <p v-if="resume && missingInTitle.length > 0" class="text-sm text-muted-foreground">
        В заголовке есть, в резюме нет: <span class="font-medium text-foreground">{{ missingInTitle.join(", ") }}</span>.
      </p>
    </div>
  </section>
</template>
