<script setup lang="ts">
import type { ApplicationRecord } from "@otbor/contract"
import { onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatDate } from "../format"
import Badge from "../components/Badge.vue"

const applications = ref<ReadonlyArray<ApplicationRecord>>([])
const stateFilter = ref("")
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    applications.value = await api.applications({
      limit: 200,
      state: stateFilter.value === "" ? undefined : stateFilter.value
    })
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

watch(stateFilter, load)
onMounted(load)
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Applications</h1>
        <p class="subtle">One durable workflow per application. The cloud, not the harness, owns state.</p>
      </div>
      <button class="button" :disabled="loading" @click="load">
        {{ loading ? "Loading…" : "Refresh" }}
      </button>
    </header>

    <div class="toolbar">
      <label>
        State
        <select v-model="stateFilter">
          <option value="">all</option>
          <option value="draft">draft</option>
          <option value="queued">queued</option>
          <option value="submitting">submitting</option>
          <option value="submitted">submitted</option>
          <option value="skipped">skipped</option>
          <option value="needs_human">needs_human</option>
          <option value="failed">failed</option>
        </select>
      </label>
      <span class="subtle">{{ applications.length }} shown</span>
    </div>

    <div v-if="error" class="panel panel-error">
      <strong>Could not list applications</strong>
      <p>{{ error }}</p>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Vacancy</th>
            <th>Employer</th>
            <th>Account</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="application in applications" :key="application.id">
            <td><Badge :value="application.state" /></td>
            <td>
              <a :href="`#/applications/${application.id}`" class="row-link">
                {{ application.vacancyTitle ?? application.vacancyId }}
              </a>
            </td>
            <td>{{ application.employerName ?? "—" }}</td>
            <td class="mono small">{{ application.hhAccountId }}</td>
            <td class="nowrap subtle">{{ formatDate(application.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="loading" class="empty">Loading…</p>
      <p v-else-if="applications.length === 0" class="empty">No applications match this filter.</p>
    </div>
  </section>
</template>
