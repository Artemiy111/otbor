<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ExternalLink } from "@lucide/vue"
import type { HhAccountRecord, ResumeRecord, VacancySummary } from "@otbor/contract"
import { RejectVacancyButton } from "@/features/vacancy-reject"
import { cn, vacancyPath } from "@/shared/lib"
import { Button, Hint } from "@/shared/ui"

/**
 * Быстрые действия строки. Откликнуться ведёт на страницу вакансии (отправка
 * только там), открытие на hh внешнее. Кнопка отбраковки грузит свои данные при
 * монтировании, поэтому монтируется, когда строку наводят или фокусируют (на
 * сенсорных экранах сразу), и потом только скрывается: открытое меню не пропадает.
 */
const props = defineProps<{
  vacancy: VacancySummary
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  scopeAccountId: string | null
  /** Строку навели или сфокусировали. */
  engaged: boolean
  /** Устройство без наведения: действия видны всегда. */
  touch: boolean
}>()

const mounted = ref(false)
watch(
  () => props.engaged || props.touch,
  (value) => {
    if (value) mounted.value = true
  },
  { immediate: true }
)

const applied = computed(() => {
  const state = props.vacancy.application?.state
  return state === "submitted" || state === "submitting" || state === "queued"
})

/** Резюме отбраковки: то, по которому принято решение, иначе активное резюме аккаунта. */
const resumeId = computed(() => {
  const decided = props.vacancy.decision?.resumeId
  if (decided) return decided
  const own = props.resumes.filter((resume) => resume.hhAccountId === props.scopeAccountId)
  return (own.find((resume) => resume.isActive) ?? own[0])?.id ?? ""
})
</script>

<template>
  <div
    :class="
      cn(
        'relative z-10 flex flex-wrap items-center gap-1.5',
        // С наведением действия всплывают над строкой, не занимая места; без него идут в потоке.
        '[@media(hover:hover)]:absolute [@media(hover:hover)]:bottom-2 [@media(hover:hover)]:right-3',
        '[@media(hover:hover)]:rounded-md [@media(hover:hover)]:border [@media(hover:hover)]:border-border [@media(hover:hover)]:bg-background [@media(hover:hover)]:p-1 [@media(hover:hover)]:shadow-sm',
        '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity',
        '[@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100'
      )
    "
  >
    <Button v-if="!applied" as-child size="sm">
      <a :href="`${vacancyPath(vacancy.id)}#apply`">Откликнуться</a>
    </Button>
    <RejectVacancyButton
      v-if="mounted && scopeAccountId"
      :vacancy-id="vacancy.id"
      :accounts="accounts"
      :resumes="resumes"
      :account-id="scopeAccountId"
      :resume-id="resumeId"
    />
    <Hint text="Открыть на hh.ru в новой вкладке">
      <Button as-child variant="outline" size="sm">
        <a :href="vacancy.canonicalUrl" target="_blank" rel="noreferrer" aria-label="Открыть на hh">
          <ExternalLink class="size-4" />
          <span class="[@media(hover:hover)]:sr-only">Открыть на hh</span>
        </a>
      </Button>
    </Hint>
  </div>
</template>
