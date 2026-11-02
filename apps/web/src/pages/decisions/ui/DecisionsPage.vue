<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { DecisionVerdictFilter } from "@/features/decision-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  decisionReasonLabel,
  describeError,
  formatDate,
  formatPriority,
  roleFamilyLabel,
  vacancyPath
} from "@/shared/lib"
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

const query = useQuery({
  key: () => decisionKeys.list(verdict.value),
  query: () =>
    decisionApi.list({
      limit: 200,
      verdict: verdict.value === "all" ? undefined : verdict.value
    })
})

const decisions = computed(() => query.data.value ?? [])
</script>

<template>
  <section>
    <PageHeader
      title="Решения"
      description="Сохранённые вердикты отбора, новые сверху. Решение не пересчитывается для показа."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <DecisionVerdictFilter v-model="verdict" />
      <span class="pb-2 text-xs text-muted-foreground">Показано: {{ decisions.length }}</span>
    </div>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить решения</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Вакансия</TableHead>
              <TableHead>Вердикт</TableHead>
              <TableHead>Гейт</TableHead>
              <TableHead>Соответствие</TableHead>
              <TableHead>Приоритет</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Создано</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="query.isPending.value">
              <TableRow v-for="index in 8" :key="index">
                <TableCell :colspan="7">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="decisions.length === 0">
              <TableCell :colspan="7">
                <EmptyState
                  title="Решений не найдено"
                  description="Оцените вакансию, чтобы сохранить артефакт решения."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="decision in decisions" :key="decision.id">
              <TableCell class="max-w-[360px]">
                <a
                  :href="vacancyPath(decision.vacancyId)"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ decision.vacancyTitle ?? decision.vacancyId }}
                </a>
                <div v-if="decision.reasons.length > 0" class="mt-1 flex flex-wrap gap-1">
                  <Badge
                    v-for="reason in decision.reasons"
                    :key="reason.code + (reason.detail ?? '')"
                    variant="secondary"
                    class="font-normal"
                    :title="reason.code"
                  >
                    {{ decisionReasonLabel(reason.code) }}
                    <span class="ml-1 font-mono text-[10px] opacity-60">{{ reason.code }}</span>
                  </Badge>
                </div>
              </TableCell>
              <TableCell><StatusBadge :value="decision.verdict" raw /></TableCell>
              <TableCell><StatusBadge :value="decision.gate" raw /></TableCell>
              <TableCell class="tabular-nums">{{ decision.fit }}</TableCell>
              <TableCell class="font-mono tabular-nums">{{ formatPriority(decision.priority) }}</TableCell>
              <TableCell>{{ roleFamilyLabel(decision.roleFamily) }}</TableCell>
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
