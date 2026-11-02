<script setup lang="ts">
import type { HarnessJob, InferenceResult } from "@otbor/contract"
import { computed, onUnmounted, ref } from "vue"
import { api, describeError } from "../api"
import { formatDate } from "../format"
import Badge from "../components/Badge.vue"

/**
 * Inference is a queue job: the cloud only enqueues the prompt, an inference
 * harness runs it through ACP and writes the answer into `job.result`. The page
 * therefore polls `InferenceGet` instead of waiting on one long RPC.
 */
const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 180_000
const TERMINAL = new Set([
  "done",
  "failed",
  "dead",
  "needs_human",
  "needs_reconcile",
  "cancelled"
])

const prompt = ref("")
const system = ref("")
const model = ref("")

const job = ref<HarnessJob | null>(null)
const submitting = ref(false)
const polling = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const elapsedSeconds = ref(0)

let timer: ReturnType<typeof setTimeout> | null = null
let startedAt = 0
let run = 0
let disposed = false

const clearTimer = () => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

const stopPolling = () => {
  clearTimer()
  polling.value = false
  run += 1
}

const result = computed<InferenceResult | null>(() => {
  const raw = job.value?.result
  if (typeof raw !== "object" || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.text !== "string") return null
  return {
    text: record.text,
    model: typeof record.model === "string" ? record.model : null,
    usage: record.usage,
    providerResponse: record.providerResponse,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined
  }
})

const usageText = computed(() => {
  const usage = result.value?.usage
  if (usage === null || usage === undefined) return ""
  return typeof usage === "string" ? usage : JSON.stringify(usage, null, 2)
})

const statusHint = computed(() => {
  const status = job.value?.status
  switch (status) {
    case "failed":
    case "dead":
      return "The harness reported a terminal failure. The Queue page keeps the job and its result payload."
    case "needs_human":
      return "The harness needs an operator. Check the Queue page before retrying."
    case "needs_reconcile":
      return "The cloud is reconciling this job. Check the Queue page."
    case "cancelled":
      return "This job was cancelled."
    default:
      return ""
  }
})

const schedule = (id: string, token: number) => {
  timer = setTimeout(() => {
    void poll(id, token)
  }, POLL_INTERVAL_MS)
}

const poll = async (id: string, token: number) => {
  if (disposed || token !== run) return

  const waited = Date.now() - startedAt
  elapsedSeconds.value = Math.round(waited / 1_000)

  if (waited >= POLL_TIMEOUT_MS) {
    stopPolling()
    notice.value =
      `No answer after ${Math.round(POLL_TIMEOUT_MS / 1_000)} s. ` +
      (job.value?.status === "pending" || job.value?.status === "leased"
        ? "The job is still waiting for an inference harness. Start one with `bun run harness`."
        : "The job has not reached a terminal status yet. Check the Queue page.")
    return
  }

  try {
    const next = await api.inferenceGet(id)
    if (disposed || token !== run) return

    job.value = next
    if (TERMINAL.has(next.status)) {
      stopPolling()
      return
    }
    schedule(id, token)
  } catch (cause) {
    if (disposed || token !== run) return
    stopPolling()
    error.value = describeError(cause)
  }
}

const submit = async () => {
  const text = prompt.value.trim()
  if (text === "") {
    error.value = "Prompt must not be empty."
    return
  }

  stopPolling()
  error.value = null
  notice.value = null
  job.value = null
  submitting.value = true
  elapsedSeconds.value = 0
  startedAt = Date.now()

  try {
    const enqueued = await api.inferenceEnqueue({
      prompt: text,
      system: system.value.trim() === "" ? undefined : system.value.trim(),
      model: model.value.trim() === "" ? undefined : model.value.trim()
    })
    if (disposed) return

    job.value = enqueued.job
    if (TERMINAL.has(enqueued.job.status)) return

    polling.value = true
    const token = ++run
    schedule(enqueued.job.id, token)
  } catch (cause) {
    if (disposed) return
    error.value = describeError(cause)
  } finally {
    if (!disposed) submitting.value = false
  }
}

onUnmounted(() => {
  disposed = true
  stopPolling()
})
</script>

<template>
  <section>
    <header class="page-head">
      <div>
        <h1>Inference</h1>
        <p class="subtle">
          One ACP prompt in the harness queue. The cloud never calls a model directly.
        </p>
      </div>
      <span v-if="polling" class="subtle small">polling · {{ elapsedSeconds }} s</span>
    </header>

    <div v-if="error" class="panel panel-error">
      <strong>Inference unavailable</strong>
      <p>{{ error }}</p>
      <p class="subtle">
        The page uses the same <code>/rpc</code> group as the CLI. Start the server with
        <code>bun run server</code>, and make sure a harness is running with
        <code>bun run harness</code>.
      </p>
    </div>

    <div v-if="notice" class="panel panel-note">
      <strong>Waiting stopped</strong>
      <p>{{ notice }}</p>
    </div>

    <form class="panel" @submit.prevent="submit">
      <h2>Prompt</h2>

      <div class="field">
        <label for="inference-prompt">Prompt</label>
        <textarea
          id="inference-prompt"
          v-model="prompt"
          rows="8"
          placeholder="Ask the harness model something…"
          :disabled="submitting || polling"
        />
      </div>

      <div class="field-row">
        <div class="field">
          <label for="inference-system">System prompt <span class="subtle">optional</span></label>
          <textarea
            id="inference-system"
            v-model="system"
            rows="3"
            placeholder="Extra instructions for this run"
            :disabled="submitting || polling"
          />
        </div>
        <div class="field">
          <label for="inference-model">Model <span class="subtle">optional</span></label>
          <input
            id="inference-model"
            v-model="model"
            type="text"
            placeholder="provider/model"
            :disabled="submitting || polling"
          />
          <p class="subtle small">
            A fallback only: the model recorded by the ACP session wins.
          </p>
        </div>
      </div>

      <div class="toolbar toolbar-tight form-actions">
        <button class="button" type="submit" :disabled="submitting || polling">
          {{ submitting ? "Enqueuing…" : polling ? "Waiting…" : "Run inference" }}
        </button>
        <span v-if="polling" class="subtle small">Polling every second, up to 180 s.</span>
      </div>
    </form>

    <template v-if="job">
      <div class="detail-grid">
        <article class="card">
          <span class="card-label">Job</span>
          <strong class="card-value mono small">{{ job.id }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Status</span>
          <Badge :value="job.status" />
        </article>
        <article class="card">
          <span class="card-label">Attempts</span>
          <strong class="card-value">{{ job.attempts }} / {{ job.maxAttempts }}</strong>
        </article>
        <article class="card">
          <span class="card-label">Created</span>
          <strong class="card-value">{{ formatDate(job.createdAt) }}</strong>
        </article>
      </div>

      <div v-if="statusHint" class="panel panel-error">
        <strong>Inference {{ job.status }}</strong>
        <p>{{ statusHint }}</p>
      </div>

      <div v-if="result" class="panel">
        <h2>Answer</h2>
        <div class="result-meta">
          <span v-if="result.model" class="chip mono">{{ result.model }}</span>
          <span v-if="result.durationMs !== undefined" class="chip">
            {{ result.durationMs }} ms
          </span>
        </div>
        <pre class="result-text">{{ result.text }}</pre>

        <template v-if="usageText !== ''">
          <h3>Usage</h3>
          <pre class="payload">{{ usageText }}</pre>
        </template>
      </div>

      <p v-else-if="polling" class="subtle">Waiting for the harness to write a result…</p>
    </template>
  </section>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 0.9rem;
}

.field label {
  display: block;
  color: var(--muted);
  font-size: 0.82rem;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.9rem;
}

.field textarea,
.field input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  color: var(--text);
  padding: 0.55rem 0.65rem;
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}

.field textarea:focus,
.field input:focus {
  outline: none;
  border-color: var(--accent);
}

.field textarea:disabled,
.field input:disabled {
  opacity: 0.6;
}

.form-actions {
  margin-bottom: 0;
}

.panel-note {
  border-color: #6a5322;
  background: var(--amber-soft);
}

.panel-note p {
  margin-top: 0.35rem;
  color: #f0d6a3;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
}

.result-text {
  max-height: 480px;
  overflow: auto;
  margin: 0;
  padding: 0.9rem;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: #11161e;
  color: #c6cedb;
  font-size: 0.82rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
