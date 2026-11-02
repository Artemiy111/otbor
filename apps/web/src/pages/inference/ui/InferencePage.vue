<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { InferenceResult, type HarnessJob } from "@otbor/contract"
import { Option, Schema } from "effect"
import { CircleAlert } from "lucide-vue-next"
import { inferenceApi, inferenceKeys } from "@/entities/inference"
import { InferenceEnqueueForm } from "@/features/inference-enqueue"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusBadge
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

/**
 * Inference is a queue job: the cloud only enqueues the prompt, an inference
 * harness runs it through ACP and writes the answer into `job.result`. The page
 * therefore refetches `InferenceGet` instead of waiting on one long RPC.
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

const jobId = ref<string | null>(null)
const lastJob = ref<HarnessJob | null>(null)
const polling = ref(false)
const elapsedSeconds = ref(0)
const notice = ref<string | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let startedAt = 0

const {
  data: jobData,
  error: queryError,
  refetch
} = useQuery({
  key: () => inferenceKeys.job(jobId.value ?? "none"),
  query: () => inferenceApi.get(jobId.value as string),
  enabled: () => jobId.value !== null
})

const job = computed(() => {
  const fetched = jobData.value
  if (fetched !== undefined && fetched.id === jobId.value) return fetched
  return lastJob.value
})

const result = computed<InferenceResult | null>(() => {
  const raw = job.value?.result
  if (raw === undefined || raw === null) return null
  const decoded = Schema.decodeUnknownOption(InferenceResult)(raw)
  return Option.isSome(decoded) ? decoded.value : null
})

const usageText = computed(() => {
  const usage = result.value?.usage
  if (usage === null || usage === undefined) return ""
  return typeof usage === "string" ? usage : (JSON.stringify(usage, null, 2) ?? "")
})

const statusHint = computed(() => {
  switch (job.value?.status) {
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

const errorText = computed(() =>
  queryError.value === null ? null : describeError(queryError.value)
)

const clearTimer = () => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

const stopPolling = () => {
  clearTimer()
  polling.value = false
}

const tick = () => {
  if (!polling.value) return

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

  timer = setTimeout(async () => {
    if (!polling.value) return
    await refetch()
    if (!polling.value) return

    const status = job.value?.status
    if (status !== undefined && TERMINAL.has(status)) {
      stopPolling()
      return
    }
    tick()
  }, POLL_INTERVAL_MS)
}

const startPolling = () => {
  stopPolling()
  notice.value = null
  startedAt = Date.now()
  elapsedSeconds.value = 0
  polling.value = true
  tick()
}

const onEnqueued = (enqueued: HarnessJob) => {
  lastJob.value = enqueued
  jobId.value = enqueued.id
  if (TERMINAL.has(enqueued.status)) {
    stopPolling()
    return
  }
  startPolling()
}

watch(
  () => job.value?.status,
  (status) => {
    if (status !== undefined && TERMINAL.has(status)) stopPolling()
  }
)

watch(queryError, (value) => {
  if (value !== null) stopPolling()
})

onUnmounted(stopPolling)
</script>

<template>
  <section>
    <PageHeader
      title="Inference"
      description="One ACP prompt in the harness queue. The cloud never calls a model directly."
    >
      <template #actions>
        <span v-if="polling" class="text-xs text-muted-foreground">
          polling · {{ elapsedSeconds }} s
        </span>
      </template>
    </PageHeader>

    <Alert v-if="notice" variant="warning" class="mb-4">
      <CircleAlert />
      <AlertTitle>Waiting stopped</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Inference unavailable</AlertTitle>
      <AlertDescription>
        <p>{{ errorText }}</p>
        <p class="mt-1 text-xs opacity-80">
          The page uses the same <code>/rpc</code> group as the CLI. Start the server with
          <code>bun run server</code>, and make sure a harness is running with
          <code>bun run harness</code>.
        </p>
      </AlertDescription>
    </Alert>

    <InferenceEnqueueForm :busy="polling" @enqueued="onEnqueued" />

    <template v-if="job">
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Job" :value="job.id" mono />
        <StatCard label="Status">
          <StatusBadge :value="job.status" />
        </StatCard>
        <StatCard label="Attempts" :value="`${job.attempts} / ${job.maxAttempts}`" />
        <StatCard label="Created" :value="formatDate(job.createdAt)" />
      </div>

      <Alert v-if="statusHint" variant="warning" class="mt-4">
        <CircleAlert />
        <AlertTitle>Inference {{ job.status }}</AlertTitle>
        <AlertDescription>{{ statusHint }}</AlertDescription>
      </Alert>

      <Card v-if="result" class="mt-4">
        <CardHeader>
          <CardTitle>Answer</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="mb-3 flex flex-wrap gap-1.5">
            <Badge v-if="result.model" variant="secondary" class="font-mono">
              {{ result.model }}
            </Badge>
            <Badge v-if="result.durationMs !== undefined" variant="outline">
              {{ result.durationMs }} ms
            </Badge>
          </div>
          <pre
            class="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
          >{{ result.text }}</pre>

          <template v-if="usageText !== ''">
            <h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Usage
            </h3>
            <pre
              class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-[11px]"
            >{{ usageText }}</pre>
          </template>
        </CardContent>
      </Card>

      <p v-else-if="polling" class="mt-4 text-sm text-muted-foreground">
        Waiting for the harness to write a result…
      </p>
    </template>
  </section>
</template>
