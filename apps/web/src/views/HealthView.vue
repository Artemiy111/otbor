<script setup lang="ts">
import type { Health } from "@otbor/contract"
import { onMounted, ref } from "vue"
import { api, describeError } from "../api"
import { formatDate } from "../format"
import Badge from "../components/Badge.vue"

const health = ref<Health | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    health.value = await api.health()
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Health</h1>
        <p class="subtle">Cloud RPC status and database connectivity.</p>
      </div>
      <button class="button" :disabled="loading" @click="load">
        {{ loading ? "Checking…" : "Refresh" }}
      </button>
    </header>

    <div v-if="error" class="panel panel-error">
      <strong>RPC unavailable</strong>
      <p>{{ error }}</p>
      <p class="subtle">Start the server with <code>bun run server</code>.</p>
    </div>

    <div v-else-if="health" class="card-grid">
      <article class="card">
        <span class="card-label">Status</span>
        <Badge :value="health.status" />
      </article>
      <article class="card">
        <span class="card-label">Database</span>
        <Badge :value="health.database ? 'ok' : 'down'" />
      </article>
      <article class="card">
        <span class="card-label">Version</span>
        <strong class="card-value">{{ health.version }}</strong>
      </article>
      <article class="card">
        <span class="card-label">Server time</span>
        <strong class="card-value">{{ formatDate(health.now) }}</strong>
      </article>
    </div>

    <p v-else-if="loading" class="subtle">Loading…</p>
  </section>
</template>
