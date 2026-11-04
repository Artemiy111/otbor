<script setup lang="ts">
import { VacancyApplyPanel } from "@/features/vacancy-apply"
import type { VacancyPage } from "../model"

defineProps<{ page: VacancyPage }>()
</script>

<template>
  <VacancyApplyPanel
    v-if="page.data.value"
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
