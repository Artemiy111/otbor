<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { GateVerdict, VacancySummary } from "@otbor/contract"
import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-vue-next"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { VacancyGateFilter } from "@/features/vacancy-filter"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, formatSalary } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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

const PAGE_SIZE = 50

const offset = ref(0)
const gate = ref("all")

const loadGates = async (
  items: ReadonlyArray<VacancySummary>
): Promise<Record<string, GateVerdict>> => {
  const titles = [...new Set(items.map((item) => item.title))]
  const settled = await Promise.all(
    titles.map(async (title) => {
      try {
        const preview = await vacancyApi.titlePreview(title)
        return [title, preview.verdict] as const
      } catch {
        return [title, null] as const
      }
    })
  )

  const gates: Record<string, GateVerdict> = {}
  for (const [title, verdict] of settled) {
    if (verdict !== null) gates[title] = verdict
  }
  return gates
}

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: () => vacancyKeys.list({ offset: offset.value, gate: gate.value }),
  query: async () => {
    const result = await vacancyApi.list({
      limit: PAGE_SIZE,
      offset: offset.value,
      gate: gate.value === "all" ? undefined : gate.value
    })
    const gates = await loadGates(result.items)
    return { ...result, gates }
  }
})

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const total = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const canGoBack = computed(() => offset.value > 0)
const canGoForward = computed(() => offset.value + PAGE_SIZE < total.value)

const gateFor = (title: string): GateVerdict | null => data.value?.gates[title] ?? null

const move = (delta: number) => {
  offset.value = Math.max(0, offset.value + delta * PAGE_SIZE)
}

watch(gate, () => {
  offset.value = 0
})
</script>

<template>
  <section>
    <PageHeader
      title="Vacancies"
      description="The corpus as the gate sees it. Gate comes from the title verdict cache."
    >
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <VacancyGateFilter v-model="gate" />
      <span class="text-sm text-muted-foreground">
        {{ total }} total · page {{ page }} / {{ totalPages }}
      </span>
      <div class="flex-1" />
      <Button variant="outline" size="sm" :disabled="!canGoBack || isLoading" @click="move(-1)">
        <ChevronLeft class="h-4 w-4" />
        Previous
      </Button>
      <Button variant="outline" size="sm" :disabled="!canGoForward || isLoading" @click="move(1)">
        Next
        <ChevronRight class="h-4 w-4" />
      </Button>
    </div>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not list vacancies</AlertTitle>
      <AlertDescription>{{ describeError(error) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Employer</TableHead>
              <TableHead>Salary</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Gate</TableHead>
              <TableHead>Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="isPending">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="6">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="data && data.items.length === 0">
              <TableCell :colspan="6">
                <EmptyState
                  title="No vacancies match this filter"
                  description="Change the gate filter or crawl more of the corpus."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="vacancy in data?.items ?? []" :key="vacancy.id">
              <TableCell>
                <a
                  :href="`#/vacancies/${vacancy.id}`"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ vacancy.title }}
                </a>
                <div class="text-xs text-muted-foreground">
                  {{ vacancy.seniority }}
                  <span v-if="vacancy.archived"> · archived</span>
                </div>
              </TableCell>
              <TableCell>{{ vacancy.employerName ?? "—" }}</TableCell>
              <TableCell class="whitespace-nowrap">
                {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
              </TableCell>
              <TableCell>{{ vacancy.areaName ?? "—" }}</TableCell>
              <TableCell>
                <StatusBadge v-if="gateFor(vacancy.title)" :value="gateFor(vacancy.title)!" />
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(vacancy.lastSeenAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
