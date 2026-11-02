<script setup lang="ts">
import { computed } from "vue"
import { apiEndpoint } from "./api"
import { route } from "./router"
import ApplicationDetailView from "./views/ApplicationDetailView.vue"
import ApplicationsView from "./views/ApplicationsView.vue"
import DecisionsView from "./views/DecisionsView.vue"
import HealthView from "./views/HealthView.vue"
import QueueView from "./views/QueueView.vue"
import VacanciesView from "./views/VacanciesView.vue"
import VacancyDetailView from "./views/VacancyDetailView.vue"

const nav = [
  { label: "Health", hash: "#/health", section: "health" },
  { label: "Vacancies", hash: "#/vacancies", section: "vacancies" },
  { label: "Decisions", hash: "#/decisions", section: "decisions" },
  { label: "Applications", hash: "#/applications", section: "applications" },
  { label: "Queue", hash: "#/queue", section: "queue" }
] as const

const section = computed(() => {
  switch (route.value.name) {
    case "vacancy":
      return "vacancies"
    case "application":
      return "applications"
    default:
      return route.value.name
  }
})

const vacancyId = computed(() => (route.value.name === "vacancy" ? route.value.id : ""))
const applicationId = computed(() => (route.value.name === "application" ? route.value.id : ""))
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <strong>otbor</strong>
        <span>operator</span>
      </div>

      <nav class="nav">
        <a
          v-for="item in nav"
          :key="item.hash"
          :href="item.hash"
          :class="{ active: section === item.section }"
        >
          {{ item.label }}
        </a>
      </nav>

      <div class="sidebar-foot">
        <span class="dot" />
        <div>
          <div>local bootstrap</div>
          <code>{{ apiEndpoint }}</code>
        </div>
      </div>
    </aside>

    <main class="main">
      <HealthView v-if="route.name === 'health'" />
      <VacanciesView v-else-if="route.name === 'vacancies'" />
      <VacancyDetailView v-else-if="route.name === 'vacancy'" :id="vacancyId" />
      <DecisionsView v-else-if="route.name === 'decisions'" />
      <ApplicationsView v-else-if="route.name === 'applications'" />
      <ApplicationDetailView v-else-if="route.name === 'application'" :id="applicationId" />
      <QueueView v-else-if="route.name === 'queue'" />
    </main>
  </div>
</template>
