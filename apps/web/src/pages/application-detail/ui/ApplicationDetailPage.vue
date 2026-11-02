<script setup lang="ts">
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "lucide-vue-next"
import { applicationApi, applicationKeys } from "@/entities/application"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, formatPriority } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

const props = defineProps<{ id: string }>()

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: () => applicationKeys.detail(props.id),
  query: () => applicationApi.get(props.id)
})

const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `$${value.toFixed(4)}`
</script>

<template>
  <section>
    <PageHeader
      :title="data?.application.vacancyTitle ?? data?.application.vacancyId ?? 'Application'"
      :description="
        data
          ? [data.application.employerName ?? 'unknown employer', data.application.resumeId ? `resume ${data.application.resumeId}` : null]
              .filter(Boolean)
              .join(' · ')
          : undefined
      "
      back-to="#/applications"
      back-label="Applications"
    >
      <template #actions>
        <StatusBadge v-if="data" :value="data.application.state" />
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="`#/vacancies/${data.application.vacancyId}`">Vacancy</a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not load application</AlertTitle>
      <AlertDescription>{{ describeError(error) }}</AlertDescription>
    </Alert>

    <div v-if="isPending" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Account" :value="data.application.hhAccountId" mono />
        <StatCard label="Created" :value="formatDate(data.application.createdAt)" />
        <StatCard label="Updated" :value="formatDate(data.application.updatedAt)" />
        <StatCard label="Attempts" :value="data.attempts.length" />
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Attempts</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <Table v-if="data.attempts.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead>Seq</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Harness</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="attempt in data.attempts" :key="attempt.id">
                <TableCell>{{ attempt.seq }}</TableCell>
                <TableCell><StatusBadge :value="attempt.stage" /></TableCell>
                <TableCell>
                  <StatusBadge v-if="attempt.exit" :value="attempt.exit.tag" />
                  <span v-else class="text-muted-foreground">—</span>
                  <div v-if="attempt.exit?.message" class="mt-1 text-xs text-muted-foreground">
                    {{ attempt.exit.message }}
                  </div>
                </TableCell>
                <TableCell class="font-mono text-xs">{{ attempt.harnessId ?? "—" }}</TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">
                  {{ formatDate(attempt.startedAt) }}
                </TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">
                  {{ formatDate(attempt.finishedAt) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-else title="No attempts recorded" />
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Kit</CardTitle>
        </CardHeader>
        <CardContent>
          <template v-if="data.kit">
            <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" class="font-mono">form {{ data.kit.formHash }}</Badge>
              <Badge variant="outline" class="font-mono">model {{ data.kit.model ?? "—" }}</Badge>
              <Badge variant="outline" class="font-mono">cost {{ cost(data.kit.costUsd) }}</Badge>
            </div>

            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Letter
            </h3>
            <pre
              class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
            >{{ data.kit.letter ?? "No cover letter." }}</pre>

            <h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Answers
            </h3>
            <div v-if="data.kit.answers.length > 0" class="space-y-2">
              <div
                v-for="(answer, index) in data.kit.answers"
                :key="index"
                class="rounded-md border border-border bg-muted/20 p-3"
              >
                <div class="mb-1 text-xs text-muted-foreground">{{ answer.question }}</div>
                <div class="whitespace-pre-wrap text-sm">{{ answer.answer }}</div>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">No form answers.</p>
          </template>
          <p v-else class="text-sm text-muted-foreground">Kit has not been prepared.</p>
        </CardContent>
      </Card>

      <Card v-if="data.decision" class="mt-4">
        <CardHeader>
          <CardTitle>Decision</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge :value="data.decision.verdict" />
            <StatusBadge :value="data.decision.gate" />
            <Badge variant="outline">fit {{ data.decision.fit }}</Badge>
            <Badge variant="outline" class="font-mono">
              priority {{ formatPriority(data.decision.priority) }}
            </Badge>
            <span class="text-xs text-muted-foreground">
              {{ formatDate(data.decision.createdAt) }}
            </span>
          </div>
          <div v-if="data.decision.reasons.length > 0" class="mt-3 flex flex-wrap gap-1">
            <Badge
              v-for="reason in data.decision.reasons"
              :key="reason.code + (reason.detail ?? '')"
              variant="secondary"
              class="font-mono text-[10px] font-normal"
            >
              {{ reason.code }}<template v-if="reason.detail">: {{ reason.detail }}</template>
            </Badge>
          </div>
        </CardContent>
      </Card>
    </template>
  </section>
</template>
