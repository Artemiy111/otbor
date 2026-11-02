<script setup lang="ts">
import type { DecisionRecord } from "@otbor/contract"
import { onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatDate, formatPriority } from "../format"
import Badge from "../components/Badge.vue"

const decisions = ref<ReadonlyArray<DecisionRecord>>([])
const verdictFilter = ref("")
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    decisions.value = await api.decisions({
      limit: 200,
      verdict: verdictFilter.value === "" ? undefined : verdictFilter.value
    })
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

watch(verdictFilter, load)
onMounted(load)
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Decisions</h1>
        <p class="subtle">Stored artifacts, newest first. A decision is never recomputed for display.</p>
      </div>
      <button class="button" :disabled="loading" @click="load">
        {{ loading ? "Loading…" : "Refresh" }}
      </button>
    </header>

    <div class="toolbar">
      <label>
        Verdict
        <select v-model="verdictFilter">
          <option value="">all</option>
          <option value="apply">apply</option>
          <option value="draft">draft</option>
          <option value="skip">skip</option>
        </select>
      </label>
      <span class="subtle">{{ decisions.length }} shown</span>
    </div>

    <div v-if="error" class="panel panel-error">
      <strong>Could not list decisions</strong>
      <p>{{ error }}</p>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Vacancy</th>
            <th>Verdict</th>
            <th>Gate</th>
            <th>Fit</th>
            <th>Priority</th>
            <th>Role</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="decision in decisions" :key="decision.id">
            <td>
              <a :href="`#/vacancies/${decision.vacancyId}`" class="row-link">
                {{ decision.vacancyTitle ?? decision.vacancyId }}
              </a>
              <div v-if="decision.reasons.length > 0" class="reasons">
                <span v-for="reason in decision.reasons" :key="reason.code + (reason.detail ?? '')">
                  {{ reason.code }}
                </span>
              </div>
            </td>
            <td><Badge :value="decision.verdict" /></td>
            <td><Badge :value="decision.gate" /></td>
            <td>{{ decision.fit }}</td>
            <td class="mono">{{ formatPriority(decision.priority) }}</td>
            <td>{{ decision.roleFamily ?? "—" }}</td>
            <td class="nowrap subtle">{{ formatDate(decision.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="loading" class="empty">Loading…</p>
      <p v-else-if="decisions.length === 0" class="empty">No decisions match this filter.</p>
    </div>
  </section>
</template>
