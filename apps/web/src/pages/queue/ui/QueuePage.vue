<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "lucide-vue-next"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { QueueStatusFilter } from "@/features/queue-filter"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatAge, formatDate, payloadPreview, payloadText } from "@/shared/lib"
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
    { label: "pending", value: value.pending },
    { label: "leased", value: value.leased },
    { label: "running", value: value.running },
    { label: "done", value: value.done },
    { label: "failed", value: value.failed },
    { label: "dead", value: value.dead },
    { label: "needs human", value: value.needsHuman },
    { label: "needs reconcile", value: value.needsReconcile }
  ]
})

const isRefreshing = computed(
  () => statsQuery.isLoading.value || jobsQuery.isLoading.value
)

const errorText = computed(() => {
  const failure = jobsQuery.error.value ?? statsQuery.error.value
  return failure === null ? null : describeError(failure)
})

const refresh = () => {
  void Promise.all([statsQuery.refetch(), jobsQuery.refetch()])
}
</script>

<template>
  <section>
    <PageHeader
      title="Queue"
      description="Harness jobs. Leases are exclusive; the cloud reconciles every exit."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not read the queue</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="statsQuery.isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Skeleton v-for="index in 5" :key="index" class="h-24 w-full" />
    </div>
    <div v-else-if="stats" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" />
      <StatCard label="oldest pending" :value="formatAge(stats.oldestPendingAgeSeconds)" />
    </div>

    <div class="mb-4 mt-4 flex flex-wrap items-center gap-3">
      <QueueStatusFilter v-model="status" />
      <span class="text-sm text-muted-foreground">{{ jobs.length }} jobs shown</span>
    </div>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Lease</TableHead>
              <TableHead>Run at</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="jobsQuery.isPending">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="9">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="jobs.length === 0">
              <TableCell :colspan="9">
                <EmptyState
                  title="No jobs match this filter"
                  description="New browser and inference work appears here after it is enqueued."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="job in jobs" :key="job.id">
              <TableCell>{{ job.kind }}</TableCell>
              <TableCell>{{ job.stage }}</TableCell>
              <TableCell><StatusBadge :value="job.status" /></TableCell>
              <TableCell class="font-mono">{{ job.priority }}</TableCell>
              <TableCell>{{ job.attempts }} / {{ job.maxAttempts }}</TableCell>
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
