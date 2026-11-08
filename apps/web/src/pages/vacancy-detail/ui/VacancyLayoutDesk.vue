<script setup lang="ts">
import type { VacancyPage } from "../model"
import ResponseRows from "./response/ResponseRows.vue"
import VacancyApply from "./VacancyApply.vue"
import VacancyChat from "./VacancyChat.vue"
import VacancyDecision from "./VacancyDecision.vue"
import VacancyDescription from "./VacancyDescription.vue"
import VacancyPassport from "./VacancyPassport.vue"
import VacancyKeywords from "./VacancyKeywords.vue"
import VacancyPeople from "./VacancyPeople.vue"
import VacancySkills from "./VacancySkills.vue"

defineProps<{ page: VacancyPage }>()
const h2 = "mb-2 text-sm font-semibold"
</script>

<template>
  <div v-if="page.data.value" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem] xl:gap-0">
    <div class="min-w-0 space-y-6 xl:pr-6">
      <slot name="head" />
      <ResponseRows
        :vacancy-id="page.id()"
        :applications="page.applications.value"
        :accounts="page.accounts.value"
        :resumes="page.resumes.value"
        :account-id="page.accountId.value"
        :resume-id="page.resumeId.value"
      />
      <VacancyPassport :page="page" :data="page.data.value" :contacts="page.contacts.value" />
      <VacancyPeople :page="page" />
      <VacancySkills :data="page.data.value" :resume="page.selectedResume.value" />
      <VacancyKeywords :data="page.data.value" :resume="page.selectedResume.value" />
      <section>
        <h2 :class="h2">Описание</h2>
        <VacancyDescription :data="page.data.value" />
      </section>
    </div>
    <div class="min-w-0 xl:border-l xl:border-border xl:pl-6">
    <div class="space-y-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
      <VacancyApply :page="page" />
      <div class="border-t border-border pt-5">
        <VacancyChat :page="page" />
      </div>
      <div class="border-t border-border pt-5">
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
  </div>
</template>
