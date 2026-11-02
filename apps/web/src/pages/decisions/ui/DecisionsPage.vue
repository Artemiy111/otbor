<script setup lang="ts">
import { ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "lucide-vue-next"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { DecisionVerdictFilter } from "@/features/decision-filter"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, formatPriority } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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

const verdict = ref("all")

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: () => decisionKeys.list(verdict.value),
  query: () =>
    decisionApi.list({
      limit: 200,
      verdict: verdict.value === "all" ? undefined : verdict.value
    })
})
</script>

<template>
  <section>
    <PageHeader
      title="Decisions"
      description="Stored artifacts, newest first. A decision is never recomputed for display."
    >
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <DecisionVerdictFilter v-model="verdict" />
      <span class="text-sm text-muted-foreground">{{ data?.length ?? 0 }} shown</span>
    </div>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not list decisions</AlertTitle>
      <AlertDescription>{{ describeError(error) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vacancy</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Gate</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="isPending">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="7">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="data && data.length === 0">
              <TableCell :colspan="7">
                <EmptyState
                  title="No decisions match this filter"
                  description="Evaluate a vacancy to persist a decision artifact."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="decision in data ?? []" :key="decision.id">
              <TableCell>
                <a
                  :href="`#/vacancies/${decision.vacancyId}`"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ decision.vacancyTitle ?? decision.vacancyId }}
                </a>
                <div v-if="decision.reasons.length > 0" class="mt-1 flex flex-wrap gap-1">
                  <Badge
                    v-for="reason in decision.reasons"
                    :key="reason.code + (reason.detail ?? '')"
                    variant="secondary"
                    class="font-mono text-[10px] font-normal"
                  >
                    {{ reason.code }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell><StatusBadge :value="decision.verdict" /></TableCell>
              <TableCell><StatusBadge :value="decision.gate" /></TableCell>
              <TableCell>{{ decision.fit }}</TableCell>
              <TableCell class="font-mono">{{ formatPriority(decision.priority) }}</TableCell>
              <TableCell>{{ decision.roleFamily ?? "—" }}</TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(decision.createdAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
