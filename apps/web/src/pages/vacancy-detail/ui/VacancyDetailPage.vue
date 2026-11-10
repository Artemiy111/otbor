<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useIntersectionObserver } from "@vueuse/core"
import { CircleAlert, Send } from "@lucide/vue"
import { vacanciesReturnPath } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "@/shared/ui"
import { useVacancyPage } from "../model"
import VacancyApplications from "./VacancyApplications.vue"
import VacancyApply from "./VacancyApply.vue"
import VacancyChat from "./VacancyChat.vue"
import VacancyDescription from "./VacancyDescription.vue"
import VacancyFacts from "./VacancyFacts.vue"
import VacancyHeader from "./VacancyHeader.vue"
import VacancyPeople from "./VacancyPeople.vue"
import VacancySkillsBlock from "./VacancySkillsBlock.vue"
import VacancyVerdict from "./VacancyVerdict.vue"

const props = defineProps<{ id: string }>()
const page = useVacancyPage(() => props.id)
const data = page.data
const archived = computed(() => data.value?.vacancy.archived === true)

/* ---- панель отклика: справа на широком экране, внизу страницы на узком ---- */

const panel = ref<HTMLElement | null>(null)
const panelVisible = ref(false)
useIntersectionObserver(panel, ([entry]) => (panelVisible.value = entry?.isIntersecting ?? false), { threshold: 0.15 })

const focusPanel = async () => {
  await nextTick()
  panel.value?.scrollIntoView({ behavior: "smooth", block: "start" })
  panel.value?.focus({ preventScroll: true })
}

// `/vacancies/:id#apply` (быстрое действие «Откликнуться» в списке): сразу к панели.
let focused = false
watch(
  () => data.value !== undefined && data.value !== null,
  (loaded) => {
    if (!loaded || focused) return
    focused = true
    if (window.location.hash === "#apply") void focusPanel()
  },
  { immediate: true }
)
</script>

<template>
  <section class="pb-20 xl:pb-0">
    <!-- Загрузка: скелет повторяет раскладку, чтобы страница не прыгала. -->
    <div v-if="page.vacancyQuery.isPending.value" class="xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-6" aria-busy="true">
      <div class="min-w-0 space-y-6">
        <div class="space-y-3">
          <Skeleton class="h-4 w-56" />
          <Skeleton class="h-8 w-3/4" />
          <Skeleton class="h-4 w-48" />
          <Skeleton class="h-6 w-40" />
        </div>
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-72 w-full" />
      </div>
      <Skeleton class="mt-6 h-96 w-full xl:mt-0 xl:h-[calc(100dvh-5.5rem)]" />
    </div>

    <div v-else-if="page.notFound.value" class="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 class="text-xl font-semibold">Вакансия не найдена</h1>
      <p class="text-sm text-muted-foreground">Возможно, ссылка устарела или вакансию удалили из базы.</p>
      <Button as-child variant="outline"><a :href="vacanciesReturnPath()">К списку вакансий</a></Button>
    </div>

    <div v-else-if="page.errorText.value" class="mx-auto max-w-xl space-y-3 py-8">
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить вакансию</AlertTitle>
        <AlertDescription>{{ page.errorText.value }}</AlertDescription>
      </Alert>
      <div class="flex gap-2">
        <Button variant="outline" @click="page.vacancyQuery.refetch()">Повторить</Button>
        <Button as-child variant="ghost"><a :href="vacanciesReturnPath()">К списку вакансий</a></Button>
      </div>
    </div>

    <div v-else-if="data" class="xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-6">
      <div class="min-w-0 space-y-6">
        <VacancyHeader :page="page" />
        <VacancyVerdict :page="page" />
        <VacancyApplications
          :vacancy-id="page.id()"
          :applications="page.applications.value"
          :accounts="page.accounts.value"
          :resumes="page.resumes.value"
          :account-id="page.accountId.value"
          :resume-id="page.resumeId.value"
        />

        <section aria-labelledby="description-title" class="space-y-3">
          <h2 id="description-title" class="text-lg font-semibold">Описание</h2>
          <VacancyDescription :data="data" />
        </section>

        <VacancySkillsBlock :data="data" :resume="page.selectedResume.value" />

        <section aria-labelledby="people-title" class="space-y-3">
          <h2 id="people-title" class="text-lg font-semibold">Люди и переписка</h2>
          <VacancyPeople :page="page" />
          <VacancyChat :page="page" />
        </section>

        <VacancyFacts :page="page" :data="data" :contacts="page.contacts.value" />
      </div>

      <aside
        id="apply"
        ref="panel"
        tabindex="-1"
        aria-label="Отклик на вакансию"
        class="mt-6 min-w-0 scroll-mt-20 self-start overflow-clip rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring xl:sticky xl:top-18 xl:mt-0 xl:h-[calc(100dvh-5.5rem)]"
      >
        <VacancyApply :page="page" />
      </aside>
    </div>

    <!-- Узкий экран: панель отклика внизу страницы, к ней ведёт эта полоса. -->
    <div
      v-if="data && !archived && !panelVisible"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur sm:inset-x-auto sm:bottom-6 sm:right-6 sm:rounded-lg sm:border sm:p-2 sm:shadow-lg xl:hidden"
    >
      <Button class="w-full sm:w-auto" @click="focusPanel">
        <Send class="size-4" />
        Откликнуться
      </Button>
    </div>
  </section>
</template>
