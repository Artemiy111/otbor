<script setup lang="ts">
import type { HarnessJob, QueueStats } from "@otbor/contract"
import { computed, onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatAge, formatDate, formatDuration, payloadPreview } from "../format"
import Badge from "../components/Badge.vue"

const stats = ref<QueueStats | null>(null)
const jobs = ref<ReadonlyArray<HarnessJob>>([])
const statusFilter = ref("")
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const [nextStats, nextJobs] = await Promise.all([
      api.queueStats(),
      api.queueJobs({
        limit: 200,
        status: statusFilter.value === "" ? undefined : statusFilter.value
      })
    ])
    stats.value = nextStats
    jobs.value = nextJobs
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

const cards = computed(() => {
  if (stats.value === null) return []
  return [
    { label: "pending", value: stats.value.pending },
    { label: "leased", value: stats.value.leased },
    { label: "running", value: stats.value.running },
    { label: "done", value: stats.value.done },
    { label: "failed", value: stats.value.failed },
    { label: "dead", value: stats.value.dead },
    { label: "needs human", value: stats.value.needsHuman },
    { label: "needs reconcile", value: stats.value.needsReconcile }
  ]
})

const payloadText = (payload: unknown): string => {
  if (payload === null || payload === undefined) return "—"
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
}

watch(statusFilter, load)
onMounted(load)
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Queue</h1>
        <p class="subtle">Harness jobs. Leases are exclusive; the cloud reconciles every exit.</p>
      </div>
      <button class="button" :disabled="loading" @click="load">
        {{ loading ? "Loading…" : "Refresh" }}
      </button>
    </header>

    <div v-if="error" class="panel panel-error">
      <strong>Could not read the queue</strong>
      <p>{{ error }}</p>
    </div>

    <template v-else>
      <div v-if="stats" class="card-grid">
        <article v-for="card in cards" :key="card.label" class="card">
          <span class="card-label">{{ card.label }}</span>
          <strong class="card-value">{{ card.value }}</strong>
        </article>
        <article class="card">
          <span class="card-label">oldest pending</span>
          <strong class="card-value">{{ formatAge(stats.oldestPendingAgeSeconds) }}</strong>
        </article>
      </div>

      <div class="toolbar">
        <label>
          Status
          <select v-model="statusFilter">
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="leased">leased</option>
            <option value="running">running</option>
            <option value="done">done</option>
            <option value="failed">failed</option>
            <option value="dead">dead</option>
            <option value="needs_human">needs_human</option>
            <option value="needs_reconcile">needs_reconcile</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <span class="subtle">{{ jobs.length }} jobs shown</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Attempts</th>
              <th>Lease</th>
              <th>Run at</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in jobs" :key="job.id">
              <td>{{ job.kind }}</td>
              <td>{{ job.stage }}</td>
              <td><Badge :value="job.status" /></td>
              <td class="mono">{{ job.priority }}</td>
              <td>{{ job.attempts }} / {{ job.maxAttempts }}</td>
              <td class="subtle">
                <template v-if="job.leaseUntil">
                  <div class="mono small">{{ job.leaseId }}</div>
                  <div>{{ formatDate(job.leaseUntil) }}</div>
                </template>
                <span v-else>—</span>
              </td>
              <td class="nowrap subtle">{{ formatDate(job.runAt) }}</td>
              <td class="payload-cell">
                <details>
                  <summary class="mono small">{{ payloadPreview(job.payload) }}</summary>
                  <pre class="payload">{{ payloadText(job.payload) }}</pre>
                </details>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="loading" class="empty">Loading…</p>
        <p v-else-if="jobs.length === 0" class="empty">No jobs match this filter.</p>
      </div>
    </template>
  </section>
</template>
