<script setup lang="ts">
import { VacancyApplyPanel } from "@/features/vacancy-apply"
import type { VacancyPage } from "../model"

defineProps<{ page: VacancyPage }>()
</script>

<template>
  <section
    v-if="page.data.value?.vacancy.archived"
    class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
  >
    <h2 class="text-base font-semibold text-foreground">Отклик закрыт</h2>
    <p class="mt-1">Вакансия в архиве, hh больше не принимает отклики и письма. Новые черновики не создаются.</p>
  </section>
  <VacancyApplyPanel
    v-else-if="page.data.value"
    :vacancy-id="page.id()"
    :data="page.data.value"
    :applications="page.applications.value"
    :accounts="page.accounts.value"
    :resumes="page.resumes.value"
    v-model:account-id="page.accountId.value"
    v-model:resume-id="page.resumeId.value"
    @changed="page.refreshApplications"
  />
</template>
