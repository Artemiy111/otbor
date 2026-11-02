<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { QueueStatusFilter } from "@/features/queue-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatAge,
  formatDate,
  jobKindLabel,
  jobStageLabel,
  payloadPreview,
  payloadText
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const status = ref("all")

const statsQuery = useQuery({
  key: queueJobKeys.stats(),
  query: queueJobApi.stats
})

const jobsQuery = useQuery({
  key: () => queueJobKeys.list(status.value),
  query: () =>
    queueJobApi.list({
      limit: 200,
      status: status.value === "all" ? undefined : status.value
    })
})

const stats = computed(() => statsQuery.data.value)
const jobs = computed(() => jobsQuery.data.value ?? [])

const cards = computed(() => {
  const value = stats.value
  if (value === undefined) return []
  return [
    { label: "Ожидают", value: value.pending },
    { label: "Взяты", value: value.leased },
    { label: "Выполняются", value: value.running },
    { label: "Готовы", value: value.done },
    { label: "С ошибкой", value: value.failed },
    { label: "Исчерпаны", value: value.dead },
    { label: "Нужен человек", value: value.needsHuman },
    { label: "Нужна сверка", value: value.needsReconcile }
  ]
})

const errorText = computed(() => {
  const failure = jobsQuery.error.value ?? statsQuery.error.value
  return failure === null ? null : describeError(failure)
})

const isRefreshing = computed(
  () => statsQuery.isLoading.value || jobsQuery.isLoading.value
)

const refresh = () => {
  void Promise.all([statsQuery.refetch(), jobsQuery.refetch()])
}
</script>

<template>
  <section>
    <PageHeader
      title="Очередь"
      description="Задания harness. Аренда эксклюзивна, а каждый итог облако сверяет само."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось прочитать очередь</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="statsQuery.isPending.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Skeleton v-for="index in 5" :key="index" class="h-24 w-full" />
    </div>
    <div v-else-if="stats" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" />
      <StatCard label="Старейшее ожидание" :value="formatAge(stats.oldestPendingAgeSeconds)" />
    </div>

    <div class="mb-4 mt-4 flex flex-wrap items-end gap-3">
      <QueueStatusFilter v-model="status" />
      <span class="pb-2 text-xs text-muted-foreground">Заданий: {{ jobs.length }}</span>
    </div>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тип</TableHead>
              <TableHead>Этап</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Приоритет</TableHead>
              <TableHead>Попытки</TableHead>
              <TableHead>Аренда</TableHead>
              <TableHead>Запуск</TableHead>
              <TableHead>Задание</TableHead>
              <TableHead>Результат</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="jobsQuery.isPending.value">
              <TableRow v-for="index in 8" :key="index">
                <TableCell :colspan="9">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="jobs.length === 0">
              <TableCell :colspan="9">
                <EmptyState
                  title="Заданий нет"
                  description="Новая работа браузера и генерации появится здесь после постановки в очередь."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="job in jobs" :key="job.id">
              <TableCell>{{ jobKindLabel(job.kind) }}</TableCell>
              <TableCell>{{ jobStageLabel(job.stage) }}</TableCell>
              <TableCell><StatusBadge :value="job.status" raw /></TableCell>
              <TableCell class="font-mono tabular-nums">{{ job.priority }}</TableCell>
              <TableCell class="tabular-nums">{{ job.attempts }} / {{ job.maxAttempts }}</TableCell>
              <TableCell class="text-muted-foreground">
                <template v-if="job.leaseUntil">
                  <div class="font-mono text-xs">{{ job.leaseId }}</div>
                  <div>{{ formatDate(job.leaseUntil) }}</div>
                </template>
                <span v-else>—</span>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(job.runAt) }}
              </TableCell>
              <TableCell class="max-w-[320px]">
                <details>
                  <summary class="cursor-pointer font-mono text-xs text-muted-foreground">
                    {{ payloadPreview(job.payload) }}
                  </summary>
                  <pre
                    class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
                  >{{ payloadText(job.payload) }}</pre>
                </details>
              </TableCell>
              <TableCell class="max-w-[320px]">
                <details v-if="job.result">
                  <summary class="cursor-pointer font-mono text-xs text-muted-foreground">
                    {{ payloadPreview(job.result) }}
                  </summary>
                  <pre
                    class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
                  >{{ payloadText(job.result) }}</pre>
                </details>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
