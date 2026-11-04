<script setup lang="ts">
import type { VacancyPage } from "../model"
import VacancyApply from "./VacancyApply.vue"
import VacancyDecision from "./VacancyDecision.vue"
import VacancyDescription from "./VacancyDescription.vue"
import VacancyPassport from "./VacancyPassport.vue"
import VacancyKeywords from "./VacancyKeywords.vue"
import VacancySkills from "./VacancySkills.vue"

defineProps<{ page: VacancyPage }>()
const h2 = "mb-2 text-sm font-semibold"
</script>

<template>
  <div v-if="page.data.value" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <div class="min-w-0 space-y-6">
      <VacancyPassport :page="page" :data="page.data.value" :contacts="page.contacts.value" />
      <section>
        <h2 :class="h2">Навыки</h2>
        <VacancySkills :data="page.data.value" :resume="page.selectedResume.value" />
      </section>
      <section>
        <h2 :class="h2">Ключевые слова</h2>
        <VacancyKeywords :data="page.data.value" :resume="page.selectedResume.value" />
      </section>
      <section>
        <h2 :class="h2">Описание</h2>
        <VacancyDescription :data="page.data.value" />
      </section>
    </div>
    <div class="min-w-0 space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
      <VacancyApply :page="page" />
      <div class="rounded-lg border border-border p-4">
        <VacancyDecision
          :decisions="page.decisions.value"
          :applications="page.applications.value"
          :accounts="page.accounts.value"
          :resumes="page.resumes.value"
          :default-account-id="page.defaultAccountId.value"
        />
      </div>
    </div>
  </div>
</template>
