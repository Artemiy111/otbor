<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { GateVerdict, VacancySummary } from "@otbor/contract"
import { ChevronLeft, ChevronRight, CircleAlert, Search } from "@lucide/vue"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { VacancyGateFilter } from "@/features/vacancy-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  companyPath,
  describeError,
  formatDate,
  formatSalary,
  seniorityLabel,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

const PAGE_SIZE = 25
const LOAD_LIMIT = 200

const search = ref("")
const gate = ref("all")
const archived = ref("active")
const page = ref(1)

const gateCache = new Map<string, GateVerdict>()

const listQuery = useQuery({
  key: () =>
    vacancyKeys.list({
      gate: gate.value,
      includeArchived: archived.value === "all"
    }),
  query: () =>
    vacancyApi.list({
      limit: LOAD_LIMIT,
      offset: 0,
      gate: gate.value === "all" ? undefined : gate.value,
      includeArchived: archived.value === "all"
    })
})

const matches = (vacancy: VacancySummary, query: string): boolean => {
  const haystack = [vacancy.title, vacancy.employerName ?? "", vacancy.areaName ?? ""]
  return haystack.some((value) => value.toLowerCase().includes(query))
}

const filtered = computed<ReadonlyArray<VacancySummary>>(() => {
  const query = search.value.trim().toLowerCase()
  const items = listQuery.data.value?.items ?? []
  return query === "" ? items : items.filter((vacancy) => matches(vacancy, query))
})

const total = computed(() => listQuery.data.value?.total ?? filtered.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const pageItems = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
const pageTitles = computed(() => [...new Set(pageItems.value.map((vacancy) => vacancy.title))])

const gatesQuery = useQuery({
  key: () => ["vacancies", "gates", gate.value, archived.value, page.value, search.value] as const,
  query: async (): Promise<Record<string, GateVerdict>> => {
    const missing = pageTitles.value.filter((title) => !gateCache.has(title))
    const settled = await Promise.all(
      missing.map(async (title) => {
        try {
          const preview = await vacancyApi.titlePreview(title)
          return [title, preview.verdict] as const
        } catch {
          return [title, null] as const
        }
      })
    )
    for (const [title, verdict] of settled) {
      if (verdict !== null) gateCache.set(title, verdict)
    }
    const gates: Record<string, GateVerdict> = {}
    for (const title of pageTitles.value) {
      const verdict = gateCache.get(title)
      if (verdict !== undefined) gates[title] = verdict
    }
    return gates
  },
  enabled: () => pageTitles.value.length > 0
})

const gateFor = (title: string): GateVerdict | null => gatesQuery.data.value?.[title] ?? null
const isLoading = computed(() => listQuery.isLoading.value || gatesQuery.isLoading.value)

const resetPage = () => {
  page.value = 1
}

watch([search, gate, archived], resetPage)
watch(totalPages, (pages) => {
  if (page.value > pages) page.value = pages
})

const refresh = () => {
  void listQuery.refetch()
  void gatesQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Вакансии"
      description="Корпус вакансий глазами гейта: заголовок, компания, зарплата, город и вердикт."
    >
      <template #actions>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="min-w-52 flex-1 space-y-1.5">
        <Label for="vacancy-search" class="text-xs text-muted-foreground">Поиск</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="vacancy-search"
            v-model="search"
            type="text"
            placeholder="Название, компания или город"
            class="pl-9"
          />
        </div>
      </div>

      <VacancyGateFilter v-model="gate" />

      <div class="space-y-1.5">
        <Label for="vacancy-archived" class="text-xs text-muted-foreground">Архив</Label>
        <Select v-model="archived">
          <SelectTrigger id="vacancy-archived" class="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Только активные</SelectItem>
            <SelectItem value="all">С архивными</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="page <= 1 || isLoading" @click="page -= 1">
          <ChevronLeft class="h-4 w-4" />
          Назад
        </Button>
        <span class="text-xs text-muted-foreground">
          {{ page }} / {{ totalPages }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="page >= totalPages || isLoading"
          @click="page += 1"
        >
          Вперёд
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <p class="mb-3 text-xs text-muted-foreground">
      Найдено {{ filtered.length }} из {{ total }} · страница {{ page }} из {{ totalPages }}
      <span v-if="total > LOAD_LIMIT"> · показаны первые {{ LOAD_LIMIT }} записей</span>
    </p>

    <Alert v-if="listQuery.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансии</AlertTitle>
      <AlertDescription>{{ describeError(listQuery.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Вакансия</TableHead>
              <TableHead>Компания</TableHead>
              <TableHead>Зарплата</TableHead>
              <TableHead>Город</TableHead>
              <TableHead>Гейт</TableHead>
              <TableHead>Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="listQuery.isPending.value">
              <TableRow v-for="index in 8" :key="index">
                <TableCell :colspan="6">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="filtered.length === 0">
              <TableCell :colspan="6">
                <EmptyState
                  title="Вакансий не найдено"
                  description="Измените запрос, фильтр гейта или включите архивные вакансии."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="vacancy in pageItems" :key="vacancy.id">
              <TableCell class="max-w-[420px]">
                <a
                  :href="vacancyPath(vacancy.id)"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ vacancy.title }}
                </a>
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{{ seniorityLabel(vacancy.seniority) }}</span>
                  <Badge v-if="vacancy.archived" variant="neutral" class="text-[10px]">архив</Badge>
                </div>
              </TableCell>
              <TableCell>
                <a
                  v-if="vacancy.employerId"
                  :href="companyPath(vacancy.employerId)"
                  class="text-foreground transition-colors hover:text-primary"
                >
                  {{ vacancy.employerName ?? "Без названия" }}
                </a>
                <span v-else>{{ vacancy.employerName ?? "—" }}</span>
              </TableCell>
              <TableCell class="whitespace-nowrap">
                {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
              </TableCell>
              <TableCell>{{ vacancy.areaName ?? "—" }}</TableCell>
              <TableCell>
                <StatusBadge v-if="gateFor(vacancy.title)" :value="gateFor(vacancy.title)!" />
                <span v-else-if="gatesQuery.isPending.value" class="text-xs text-muted-foreground">
                  …
                </span>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(vacancy.publishedAt ?? vacancy.lastSeenAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
