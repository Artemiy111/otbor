<script setup lang="ts">
import { computed } from "vue"
import { ApplicationDetailPage } from "@/pages/application-detail"
import { ApplicationsPage } from "@/pages/applications"
import { BlacklistPage } from "@/pages/blacklist"
import { CompaniesPage } from "@/pages/companies"
import { CompanyDetailPage } from "@/pages/company-detail"
import { ContactsPage } from "@/pages/contacts"
import { DecisionsPage } from "@/pages/decisions"
import { HealthPage } from "@/pages/health"
import { InferencePage } from "@/pages/inference"
import { KeywordsPage } from "@/pages/keywords"
import { MailPage } from "@/pages/mail"
import { PresetsPage } from "@/pages/presets"
import { QueuePage } from "@/pages/queue"
import { SchedulesPage } from "@/pages/schedules"
import { SearchPage } from "@/pages/search"
import { TelegramPage } from "@/pages/telegram"
import ResumesPage from "@/pages/resumes"
import HhAccountsPage from "@/pages/hh-accounts"
import { VacanciesPage } from "@/pages/vacancies"
import { VacancyDetailPage } from "@/pages/vacancy-detail"
import { AppShell } from "@/widgets/app-shell"
import { activeSection, route } from "./router"

const vacancyId = computed(() => (route.value.name === "vacancy" ? route.value.id : ""))
const companyId = computed(() => (route.value.name === "company" ? route.value.id : ""))
const applicationId = computed(() =>
  route.value.name === "application" ? route.value.id : ""
)
</script>

<template>
  <AppShell :active="activeSection">
    <HealthPage v-if="route.name === 'health'" />
    <VacanciesPage v-else-if="route.name === 'vacancies'" />
    <VacancyDetailPage v-else-if="route.name === 'vacancy'" :id="vacancyId" />
    <CompaniesPage v-else-if="route.name === 'companies'" />
    <CompanyDetailPage v-else-if="route.name === 'company'" :id="companyId" />
    <KeywordsPage v-else-if="route.name === 'keywords'" />
    <DecisionsPage v-else-if="route.name === 'decisions'" />
    <ApplicationsPage v-else-if="route.name === 'applications'" />
    <ApplicationDetailPage v-else-if="route.name === 'application'" :id="applicationId" />
    <QueuePage v-else-if="route.name === 'queue'" />
    <InferencePage v-else-if="route.name === 'inference'" />
    <PresetsPage v-else-if="route.name === 'presets'" />
    <SearchPage v-else-if="route.name === 'search'" />
    <SchedulesPage v-else-if="route.name === 'schedules'" />
    <ContactsPage v-else-if="route.name === 'contacts'" />
    <MailPage v-else-if="route.name === 'mail'" />
    <TelegramPage v-else-if="route.name === 'telegram'" />
    <ResumesPage v-else-if="route.name === 'resumes'" />
    <HhAccountsPage v-else-if="route.name === 'accounts'" />
    <BlacklistPage v-else-if="route.name === 'blacklist'" />
  </AppShell>
</template>
