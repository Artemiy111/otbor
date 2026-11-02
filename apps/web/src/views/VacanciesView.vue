<script setup lang="ts">
import type { GateVerdict, VacancySummary } from "@otbor/contract"
import { computed, onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatDate, formatSalary } from "../format"
import Badge from "../components/Badge.vue"

const PAGE_SIZE = 50

const items = ref<ReadonlyArray<VacancySummary>>([])
const total = ref(0)
const offset = ref(0)
const gateFilter = ref("")
const loading = ref(false)
const gatesLoading = ref(false)
const error = ref<string | null>(null)
const gates = ref<Record<string, GateVerdict>>({})

let requestId = 0

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

const loadGates = async (rows: ReadonlyArray<VacancySummary>, current: number) => {
  const titles = [...new Set(rows.map((row) => row.title))]
  if (titles.length === 0) return

  const settled = await Promise.all(
    titles.map(async (title) => {
      try {
        const preview = await api.titlePreview(title)
        return [title, preview.verdict] as const
      } catch {
        return [title, null] as const
      }
    })
  )
  if (current !== requestId) return

  const map: Record<string, GateVerdict> = {}
  for (const [title, verdict] of settled) {
    if (verdict !== null) map[title] = verdict
  }
  gates.value = map
}

const load = async () => {
  const current = ++requestId
  loading.value = true
  gatesLoading.value = true
  error.value = null
  gates.value = {}

  try {
    const result = await api.vacancies({
      limit: PAGE_SIZE,
      offset: offset.value,
      gate: gateFilter.value === "" ? undefined : gateFilter.value
    })
    if (current !== requestId) return

    items.value = result.items
    total.value = result.total
    loading.value = false
    void loadGates(result.items, current).finally(() => {
      if (current === requestId) gatesLoading.value = false
    })
  } catch (cause) {
    if (current === requestId) error.value = describeError(cause)
  } finally {
    if (current === requestId) loading.value = false
  }
}

const move = (delta: number) => {
  offset.value = Math.max(0, offset.value + delta * PAGE_SIZE)
  void load()
}

watch(gateFilter, () => {
  offset.value = 0
  void load()
})

onMounted(load)
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Vacancies</h1>
        <p class="subtle">The corpus as the gate sees it. Gate comes from the title verdict cache.</p>
      </div>
      <button class="button" :disabled="loading" @click="load">
        {{ loading ? "Loading…" : "Refresh" }}
      </button>
    </header>

    <div class="toolbar">
      <label>
        Gate
        <select v-model="gateFilter">
          <option value="">all</option>
          <option value="match">match</option>
          <option value="unknown">unknown</option>
          <option value="reject">reject</option>
        </select>
      </label>
      <span class="subtle">{{ total }} total · page {{ page }} / {{ totalPages }}</span>
      <div class="spacer" />
      <button class="button button-ghost" :disabled="loading || offset === 0" @click="move(-1)">
        Previous
      </button>
      <button
        class="button button-ghost"
        :disabled="loading || offset + PAGE_SIZE >= total"
        @click="move(1)"
      >
        Next
      </button>
    </div>

    <div v-if="error" class="panel panel-error">
      <strong>Could not list vacancies</strong>
      <p>{{ error }}</p>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Employer</th>
            <th>Salary</th>
            <th>Area</th>
            <th>Gate</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vacancy in items" :key="vacancy.id">
            <td>
              <a :href="`#/vacancies/${vacancy.id}`" class="row-link">{{ vacancy.title }}</a>
              <div class="subtle small">
                {{ vacancy.seniority }}
                <span v-if="vacancy.archived"> · archived</span>
              </div>
            </td>
            <td>{{ vacancy.employerName ?? "—" }}</td>
            <td class="nowrap">
              {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
            </td>
            <td>{{ vacancy.areaName ?? "—" }}</td>
            <td>
              <Badge v-if="gates[vacancy.title]" :value="gates[vacancy.title]!" />
              <span v-else-if="gatesLoading" class="subtle">…</span>
              <span v-else class="subtle">—</span>
            </td>
            <td class="nowrap subtle">{{ formatDate(vacancy.lastSeenAt) }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="loading" class="empty">Loading…</p>
      <p v-else-if="items.length === 0" class="empty">No vacancies match this filter.</p>
    </div>
  </section>
</template>
