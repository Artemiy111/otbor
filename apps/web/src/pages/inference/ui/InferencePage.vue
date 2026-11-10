<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { InferenceResult, type HarnessJob } from "@otbor/contract"
import { Option, Schema } from "effect"
import { CircleAlert } from "@lucide/vue"
import { inferenceApi, inferenceKeys } from "@/entities/inference"
import { InferenceEnqueueForm } from "@/features/inference-enqueue"
import { describeError, formatDate, statusLabel } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusBadge
} from "@/shared/ui"
import { ExecutorStartGuide } from "@/widgets/executor-start"
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
/** Задание так и не взято: исполнитель, скорее всего, не запущен. */
const executorMissing = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null
let startedAt = 0

const { data: jobData, error: queryError, refetch } = useQuery({
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
      return "Исполнитель сообщил окончательную ошибку. Задание и его результат остались на странице «Очередь»."
    case "needs_human":
      return "Заданию нужен оператор. Проверьте страницу «Очередь», прежде чем повторять."
    case "needs_reconcile":
      return "Облако сверяет результат задания. Проверьте страницу «Очередь»."
    case "cancelled":
      return "Задание отменено."
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
    executorMissing.value = job.value?.status === "pending" || job.value?.status === "leased"
    notice.value =
      `Ответа нет ${Math.round(POLL_TIMEOUT_MS / 1_000)} с. ` +
      (executorMissing.value
        ? "Задание всё ещё ждёт исполнителя: похоже, он не запущен."
        : "Задание ещё не завершилось. Проверьте страницу «Очередь».")
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
  executorMissing.value = false
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
      title="Генерация (для разработчика)"
      description="Служебная страница: отправляет один произвольный запрос модели через очередь и показывает сырой ответ. Обычным откликам она не нужна: письма и оценки вакансий ставятся в очередь сами. Сервер никогда не вызывает модель напрямую, запрос выполняет исполнитель."
    >
      <template #actions>
        <span v-if="polling" class="text-xs text-muted-foreground">
          опрос · {{ elapsedSeconds }} с
        </span>
      </template>
    </PageHeader>

    <Alert v-if="notice" variant="warning" class="mb-4">
      <CircleAlert />
      <AlertTitle>Ожидание остановлено</AlertTitle>
      <AlertDescription>
        <p>{{ notice }}</p>
        <ExecutorStartGuide v-if="executorMissing" target="inference" class="mt-3" />
      </AlertDescription>
    </Alert>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Генерация недоступна</AlertTitle>
      <AlertDescription>
        <p>{{ errorText }}</p>
        <ExecutorStartGuide target="stack" class="mt-3" />
      </AlertDescription>
    </Alert>

    <InferenceEnqueueForm :busy="polling" @enqueued="onEnqueued" />

    <template v-if="job">
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Задание" :value="job.id" mono />
        <StatCard label="Статус">
          <StatusBadge :value="job.status" />
        </StatCard>
        <StatCard label="Попытки" :value="`${job.attempts} / ${job.maxAttempts}`" />
        <StatCard label="Создано" :value="formatDate(job.createdAt)" />
      </div>

      <Alert v-if="statusHint" variant="warning" class="mt-4">
        <CircleAlert />
        <AlertTitle>{{ statusLabel(job.status) }}</AlertTitle>
        <AlertDescription>{{ statusHint }}</AlertDescription>
      </Alert>

      <Card v-if="result" class="mt-4">
        <CardHeader>
          <CardTitle>Ответ</CardTitle>
          <CardDescription>Текст, который исполнитель записал в результат задания.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="mb-3 flex flex-wrap gap-1.5">
            <Badge v-if="result.model" variant="secondary" class="font-mono">
              {{ result.model }}
            </Badge>
            <Badge v-if="result.durationMs !== undefined" variant="outline">
              {{ result.durationMs }} мс
            </Badge>
          </div>
          <pre
            class="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
          >{{ result.text }}</pre>

          <template v-if="usageText !== ''">
            <h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Использование
            </h3>
            <pre
              class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs"
            >{{ usageText }}</pre>
          </template>
        </CardContent>
      </Card>

      <p v-else-if="polling" class="mt-4 text-sm text-muted-foreground">
        Ждём, когда исполнитель запишет результат…
      </p>
    </template>
  </section>
</template>
