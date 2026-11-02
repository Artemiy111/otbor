<script setup lang="ts">
import type { VacancyDetail } from "@otbor/contract"
import { onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatDate, formatSalary } from "../format"
import Badge from "../components/Badge.vue"

const props = defineProps<{ id: string }>()

const detail = ref<VacancyDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  detail.value = null
  try {
    detail.value = await api.vacancy(props.id)
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

watch(() => props.id, load)
onMounted(load)
</script>

<template>
  <section>
    <a href="#/vacancies" class="back">← Vacancies</a>

    <div v-if="error" class="panel panel-error">
      <strong>Could not load vacancy</strong>
      <p>{{ error }}</p>
    </div>

    <p v-else-if="loading" class="subtle">Loading…</p>

    <template v-else-if="detail">
      <header class="page-head">
        <div>
          <h1>{{ detail.vacancy.title }}</h1>
          <p class="subtle">
            {{ detail.vacancy.employerName ?? "unknown employer" }}
            <span v-if="detail.vacancy.areaName"> · {{ detail.vacancy.areaName }}</span>
            <span v-if="detail.vacancy.archived"> · archived</span>
          </p>
        </div>
        <div class="head-actions">
          <Badge v-if="detail.titleVerdict" :value="detail.titleVerdict" />
          <a
            :href="detail.vacancy.canonicalUrl"
            class="button button-ghost"
            target="_blank"
            rel="noreferrer"
          >
            Open on hh
          </a>
        </div>
      </header>

      <div class="detail-grid">
        <article class="card">
          <span class="card-label">Salary</span>
          <strong class="card-value">
            {{ formatSalary(detail.vacancy.salaryFrom, detail.vacancy.salaryTo, detail.vacancy.salaryCurrency) }}
          </strong>
        </article>
        <article class="card">
          <span class="card-label">Seniority</span>
          <strong class="card-value">{{ detail.vacancy.seniority }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Published</span>
          <strong class="card-value">{{ formatDate(detail.vacancy.publishedAt) }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Last seen</span>
          <strong class="card-value">{{ formatDate(detail.vacancy.lastSeenAt) }}</strong>
        </article>
      </div>

      <section class="panel">
        <h2>Skills</h2>
        <div v-if="detail.skills.length > 0" class="chips">
          <span v-for="skill in detail.skills" :key="skill" class="chip">{{ skill }}</span>
        </div>
        <p v-else class="subtle">No parsed skills.</p>
      </section>

      <section class="panel">
        <h2>Lexicon matches</h2>
        <div v-if="detail.keywords.length > 0" class="table-wrap table-flat">
          <table>
            <thead>
              <tr>
                <th>Term</th>
                <th>Matched form</th>
                <th>Title</th>
                <th>Body</th>
                <th>Skills</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="keyword in detail.keywords" :key="keyword.keywordId">
                <td>{{ keyword.term }}</td>
                <td>{{ keyword.matchedForm }}<span v-if="keyword.typo"> · typo</span></td>
                <td>{{ keyword.titleCount }}</td>
                <td>{{ keyword.bodyCount }}</td>
                <td>{{ keyword.inSkills ? "yes" : "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="subtle">No lexicon matches.</p>
      </section>

      <section class="panel">
        <h2>Description</h2>
        <pre class="description">{{ detail.descriptionText || "No description parsed." }}</pre>
      </section>
    </template>
  </section>
</template>
