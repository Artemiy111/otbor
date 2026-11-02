<script setup lang="ts">
import type { ApplicationDetail } from "@otbor/contract"
import { onMounted, ref, watch } from "vue"
import { api, describeError } from "../api"
import { formatDate } from "../format"
import Badge from "../components/Badge.vue"

const props = defineProps<{ id: string }>()

const detail = ref<ApplicationDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  detail.value = null
  try {
    detail.value = await api.application(props.id)
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
  }
}

const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `$${value.toFixed(4)}`

watch(() => props.id, load)
onMounted(load)
</script>

<template>
  <section>
    <a href="#/applications" class="back">← Applications</a>

    <div v-if="error" class="panel panel-error">
      <strong>Could not load application</strong>
      <p>{{ error }}</p>
    </div>

    <p v-else-if="loading" class="subtle">Loading…</p>

    <template v-else-if="detail">
      <header class="page-head">
        <div>
          <h1>{{ detail.application.vacancyTitle ?? detail.application.vacancyId }}</h1>
          <p class="subtle">
            {{ detail.application.employerName ?? "unknown employer" }}
            <span v-if="detail.application.resumeId"> · resume {{ detail.application.resumeId }}</span>
          </p>
        </div>
        <div class="head-actions">
          <Badge :value="detail.application.state" />
          <a :href="`#/vacancies/${detail.application.vacancyId}`" class="button button-ghost">
            Vacancy
          </a>
        </div>
      </header>

      <div class="detail-grid">
        <article class="card">
          <span class="card-label">Account</span>
          <strong class="card-value mono">{{ detail.application.hhAccountId }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Created</span>
          <strong class="card-value">{{ formatDate(detail.application.createdAt) }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Updated</span>
          <strong class="card-value">{{ formatDate(detail.application.updatedAt) }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Attempts</span>
          <strong class="card-value">{{ detail.attempts.length }}</strong>
        </article>
      </div>

      <section class="panel">
        <h2>Attempts</h2>
        <div v-if="detail.attempts.length > 0" class="table-wrap table-flat">
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Stage</th>
                <th>Exit</th>
                <th>Harness</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in detail.attempts" :key="attempt.id">
                <td>{{ attempt.seq }}</td>
                <td><Badge :value="attempt.stage" /></td>
                <td>
                  <Badge v-if="attempt.exit" :value="attempt.exit.tag" />
                  <span v-else class="subtle">—</span>
                  <div v-if="attempt.exit?.message" class="subtle small">
                    {{ attempt.exit.message }}
                  </div>
                </td>
                <td class="mono small">{{ attempt.harnessId ?? "—" }}</td>
                <td class="nowrap subtle">{{ formatDate(attempt.startedAt) }}</td>
                <td class="nowrap subtle">{{ formatDate(attempt.finishedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="subtle">No attempts recorded.</p>
      </section>

      <section class="panel">
        <h2>Kit</h2>
        <template v-if="detail.kit">
          <div class="toolbar toolbar-tight">
            <span class="subtle">form hash <code>{{ detail.kit.formHash }}</code></span>
            <span class="subtle">model {{ detail.kit.model ?? "—" }}</span>
            <span class="subtle">cost {{ cost(detail.kit.costUsd) }}</span>
          </div>
          <h3>Letter</h3>
          <pre class="description">{{ detail.kit.letter ?? "No cover letter." }}</pre>
          <h3>Answers</h3>
          <div v-if="detail.kit.answers.length > 0" class="answers">
            <article v-for="(answer, index) in detail.kit.answers" :key="index" class="answer">
              <div class="answer-question">{{ answer.question }}</div>
              <div class="answer-text">{{ answer.answer }}</div>
            </article>
          </div>
          <p v-else class="subtle">No form answers.</p>
        </template>
        <p v-else class="subtle">Kit has not been prepared.</p>
      </section>

      <section v-if="detail.decision" class="panel">
        <h2>Decision</h2>
        <div class="toolbar toolbar-tight">
          <Badge :value="detail.decision.verdict" />
          <Badge :value="detail.decision.gate" />
          <span class="subtle">fit {{ detail.decision.fit }}</span>
          <span class="subtle">priority {{ detail.decision.priority.toFixed(2) }}</span>
          <span class="subtle">{{ formatDate(detail.decision.createdAt) }}</span>
        </div>
        <div v-if="detail.decision.reasons.length > 0" class="reasons">
          <span v-for="reason in detail.decision.reasons" :key="reason.code + (reason.detail ?? '')">
            {{ reason.code }}<template v-if="reason.detail">: {{ reason.detail }}</template>
          </span>
        </div>
      </section>
    </template>
  </section>
</template>
