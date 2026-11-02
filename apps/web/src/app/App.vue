<script setup lang="ts">
import { computed } from "vue"
import { ApplicationDetailPage } from "@/pages/application-detail"
import { ApplicationsPage } from "@/pages/applications"
import { DecisionsPage } from "@/pages/decisions"
import { HealthPage } from "@/pages/health"
import { InferencePage } from "@/pages/inference"
import { QueuePage } from "@/pages/queue"
import { VacanciesPage } from "@/pages/vacancies"
import { VacancyDetailPage } from "@/pages/vacancy-detail"
import { AppShell } from "@/widgets/app-shell"
import { activeSection, route } from "./router"

const vacancyId = computed(() => (route.value.name === "vacancy" ? route.value.id : ""))
const applicationId = computed(() =>
  route.value.name === "application" ? route.value.id : ""
)
</script>

<template>
  <AppShell :active="activeSection">
    <HealthPage v-if="route.name === 'health'" />
    <VacanciesPage v-else-if="route.name === 'vacancies'" />
    <VacancyDetailPage v-else-if="route.name === 'vacancy'" :id="vacancyId" />
    <DecisionsPage v-else-if="route.name === 'decisions'" />
    <ApplicationsPage v-else-if="route.name === 'applications'" />
    <ApplicationDetailPage v-else-if="route.name === 'application'" :id="applicationId" />
    <QueuePage v-else-if="route.name === 'queue'" />
    <InferencePage v-else-if="route.name === 'inference'" />
  </AppShell>
</template>
