<script setup lang="ts">
import { VacancyApplyPanel } from "@/features/vacancy-apply"
import type { VacancyPage } from "../model"

/** Рабочая панель справа: форма отклика или, для архивной вакансии, объяснение. */
defineProps<{ page: VacancyPage }>()
</script>

<template>
  <section
    v-if="page.data.value?.vacancy.archived"
    class="space-y-2 p-4 text-sm"
    aria-labelledby="apply-closed-title"
  >
    <h2 id="apply-closed-title" class="text-base font-semibold">Отклик закрыт</h2>
    <p class="text-muted-foreground">
      Вакансия в архиве: hh больше не принимает на неё отклики и письма, поэтому форма скрыта и новые черновики не
      создаются. Отклики, которые уже были, видны слева.
    </p>
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
