<script setup lang="ts">
import { computed } from "vue"
import { useStorage } from "@vueuse/core"
import { CircleAlert, ExternalLink, RefreshCw } from "@lucide/vue"
import { RefreshButton } from "@/features/refresh-button"
import { Alert, AlertDescription, AlertTitle, Button, Hint, Skeleton } from "@/shared/ui"
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
  <section>
    <PageHeader :title="data?.vacancy.title ?? 'Вакансия'" back-to="/vacancies" back-label="Вакансии">
      <template #actions>
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
        <RefreshButton :loading="page.isLoading.value" @refresh="page.refresh" />
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
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 space-y-2.5">
          <VacancyMetaLine :data="data" />
          <VacancyProfileChips :data="data" :recon="page.recon.value" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <VacancyLayoutSwitch v-model="layout" />
        </div>
      </div>
      <VacancyLayoutDesk v-if="layout === 'desk'" :page="page" />
      <VacancyLayoutFocus v-else :page="page" />
    </template>
  </section>
</template>
