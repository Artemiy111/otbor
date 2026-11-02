<script setup lang="ts">
import { ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "lucide-vue-next"
import { applicationApi, applicationKeys } from "@/entities/application"
import { ApplicationStateFilter } from "@/features/application-filter"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
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

const state = ref("all")

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: () => applicationKeys.list(state.value),
  query: () =>
    applicationApi.list({
      limit: 200,
      state: state.value === "all" ? undefined : state.value
    })
})
</script>

<template>
  <section>
    <PageHeader
      title="Applications"
      description="One durable workflow per application. The cloud, not the harness, owns state."
    >
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <ApplicationStateFilter v-model="state" />
      <span class="text-sm text-muted-foreground">{{ data?.length ?? 0 }} shown</span>
    </div>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not list applications</AlertTitle>
      <AlertDescription>{{ describeError(error) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>State</TableHead>
              <TableHead>Vacancy</TableHead>
              <TableHead>Employer</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="isPending">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="5">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="data && data.length === 0">
              <TableCell :colspan="5">
                <EmptyState
                  title="No applications match this filter"
                  description="Applications appear here once a decision is promoted to a workflow."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="application in data ?? []" :key="application.id">
              <TableCell><StatusBadge :value="application.state" /></TableCell>
              <TableCell>
                <a
                  :href="`#/applications/${application.id}`"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ application.vacancyTitle ?? application.vacancyId }}
                </a>
              </TableCell>
              <TableCell>{{ application.employerName ?? "—" }}</TableCell>
              <TableCell class="font-mono text-xs">{{ application.hhAccountId }}</TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(application.updatedAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
