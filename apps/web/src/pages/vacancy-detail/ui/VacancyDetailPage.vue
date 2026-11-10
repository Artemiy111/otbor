<script setup lang="ts">
import { computed } from "vue"
import { useStorage } from "@vueuse/core"
import { CircleAlert, ExternalLink, RefreshCw } from "@lucide/vue"
import { Alert, AlertDescription, AlertTitle, Button, Hint, Skeleton } from "@/shared/ui"
import { RejectVacancyButton } from "@/features/vacancy-reject"
import { PageHeader } from "@/widgets/page-header"
import { useVacancyPage } from "../model"
import { LAYOUTS, type LayoutId } from "./layouts"
import VacancyLayoutDesk from "./VacancyLayoutDesk.vue"
import VacancyLayoutFocus from "./VacancyLayoutFocus.vue"
import VacancyLayoutSwitch from "./VacancyLayoutSwitch.vue"
import VacancyMetaLine from "./VacancyMetaLine.vue"
import VacancyProfileChips from "./VacancyProfileChips.vue"

const props = defineProps<{ id: string }>()
const page = useVacancyPage(() => props.id)

const stored = useStorage<LayoutId>("otbor.vacancy-layout", "desk")
const layout = computed<LayoutId>({
  get: () => (LAYOUTS.some((item) => item.id === stored.value) ? stored.value : "desk"),
  set: (value) => (stored.value = value)
})
const data = page.data
</script>

<template>
  <section :class="data?.vacancy.archived ? 'vacancy-archived' : ''">
    <PageHeader :title="data?.vacancy.title ?? 'Вакансия'" back-to="/vacancies" back-label="Вакансии">
      <template v-if="data?.vacancy.archived" #title-aside>
        <span
          class="-rotate-6 select-none rounded-md border-2 border-double border-red-600/70 px-2.5 py-0.5 text-sm font-black uppercase tracking-[0.25em] text-red-600/70 dark:border-red-400/70 dark:text-red-400/70"
        >
          Архив
        </span>
      </template>
      <template #actions>
        <RejectVacancyButton
          v-if="data"
          :vacancy-id="props.id"
          :accounts="page.accounts.value"
          :resumes="page.resumes.value"
          :account-id="page.accountId.value"
          :resume-id="page.resumeId.value"
        />
        <Hint v-if="data" text="Заново скачать страницу вакансии с hh">
        <Button
          variant="outline"
          size="sm"
          :disabled="page.hydrating.value"
          @click="page.hydrate"
        >
          <RefreshCw class="size-4" :class="page.hydrating.value ? 'animate-spin' : ''" />
          Догрузить
        </Button>
        </Hint>
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="data.vacancy.canonicalUrl" target="_blank" rel="noreferrer">
            Открыть на hh
            <ExternalLink class="h-4 w-4" />
          </a>
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="page.errorText.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансию</AlertTitle>
      <AlertDescription>{{ page.errorText.value }}</AlertDescription>
    </Alert>

    <div v-if="page.vacancyQuery.isPending.value" class="space-y-3">
      <Skeleton class="h-5 w-2/3" />
      <Skeleton class="h-6 w-1/2" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div :class="data.vacancy.archived ? 'opacity-75 saturate-50' : ''">
        <VacancyLayoutDesk v-if="layout === 'desk'" :page="page">
          <template #head>
<div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 space-y-2.5">
          <VacancyMetaLine :data="data" />
          <VacancyProfileChips :data="data" :recon="page.recon.value" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <VacancyLayoutSwitch v-model="layout" />
        </div>
      </div>
          </template>
        </VacancyLayoutDesk>
        <template v-else>
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 space-y-2.5">
          <VacancyMetaLine :data="data" />
          <VacancyProfileChips :data="data" :recon="page.recon.value" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <VacancyLayoutSwitch v-model="layout" />
        </div>
      </div>
          <VacancyLayoutFocus :page="page" />
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.vacancy-archived :deep(h1) {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
  opacity: 0.55;
}
</style>
