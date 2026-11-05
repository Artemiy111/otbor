<script setup lang="ts">
import { computed } from "vue"
import { describeKitAnswer } from "@otbor/contract"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { RefreshButton } from "@/features/refresh-button"
import {
  decisionReasonLabel,
  describeError,
  formatDate,
  formatPriority,
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
  CardDescription,
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

const query = useQuery({
  key: () => applicationKeys.detail(props.id),
  query: () => applicationApi.get(props.id)
})

const data = computed(() => query.data.value)

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

const kitAnswers = computed(() =>
  (data.value?.kit?.answers ?? []).map((raw) => describeKitAnswer(raw, data.value?.form?.form))
)

const subtitle = computed(() => {
  const application = data.value?.application
  if (application === undefined) return undefined
  return application.employerName ?? "Компания не указана"
})

const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `$${value.toFixed(4)}`
</script>

<template>
  <section>
    <PageHeader
      :title="data?.application.vacancyTitle ?? 'Отклик'"
      :description="subtitle"
      back-to="/applications"
      back-label="Отклики"
    >
      <template #actions>
        <StatusBadge v-if="data" :value="data.application.state" raw />
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="vacancyPath(data.application.vacancyId)">Вакансия</a>
        </Button>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отклик</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <div v-if="query.isPending.value" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Аккаунт">
          <AccountChip
            :account-id="data.application.hhAccountId"
            :accounts="accountsQuery.data.value ?? []"
            :resume-ids="[data.application.resumeId]"
            :resumes="resumesQuery.data.value ?? []"
          />
        </StatCard>
        <StatCard label="Создан" :value="formatDate(data.application.createdAt)" />
        <StatCard label="Обновлён" :value="formatDate(data.application.updatedAt)" />
        <StatCard label="Попыток" :value="data.attempts.length" />
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Попытки</CardTitle>
          <CardDescription>Что harness сообщил после каждой попытки.</CardDescription>
        </CardHeader>
        <CardContent class="p-0">
          <Table v-if="data.attempts.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead>№</TableHead>
                <TableHead>Этап</TableHead>
                <TableHead>Итог</TableHead>
                <TableHead>Исполнитель</TableHead>
                <TableHead>Начат</TableHead>
                <TableHead>Завершён</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="attempt in data.attempts" :key="attempt.id">
                <TableCell>{{ attempt.seq }}</TableCell>
                <TableCell><StatusBadge :value="attempt.stage" raw /></TableCell>
                <TableCell>
                  <StatusBadge v-if="attempt.exit" :value="attempt.exit.tag" raw />
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
          <EmptyState v-else title="Попыток нет" description="Harness ещё не брал этот отклик." />
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Комплект отклика</CardTitle>
          <CardDescription>Письмо и ответы на вопросы формы.</CardDescription>
        </CardHeader>
        <CardContent>
          <template v-if="data.kit">
            <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" class="font-mono">форма {{ data.kit.formHash }}</Badge>
              <Badge variant="outline" class="font-mono">модель {{ data.kit.model ?? "—" }}</Badge>
              <Badge variant="outline" class="font-mono">стоимость {{ cost(data.kit.costUsd) }}</Badge>
            </div>

            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Письмо
            </h3>
            <pre
              class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
            >{{ data.kit.letter ?? "Письмо не подготовлено." }}</pre>

            <h3 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ответы
            </h3>
            <div v-if="data.kit.answers.length > 0" class="space-y-2">
              <div
                v-for="(answer, index) in kitAnswers"
                :key="index"
                class="rounded-md border border-border bg-muted/20 p-3"
              >
                <div class="mb-1 text-xs text-muted-foreground">{{ answer.question }}</div>
                <div class="whitespace-pre-wrap text-sm">{{ answer.answer }}</div>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">Ответов на вопросы нет.</p>
          </template>
          <EmptyState
            v-else
            title="Комплект не подготовлен"
            description="Письмо и ответы появятся после генерации."
          />
        </CardContent>
      </Card>

      <Card v-if="data.decision" class="mt-4">
        <CardHeader>
          <CardTitle>Решение</CardTitle>
          <CardDescription>Вердикт, из которого создан отклик.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge :value="data.decision.verdict" raw />
            <Badge variant="outline">соответствие {{ data.decision.fit }}</Badge>
            <Badge variant="outline" class="font-mono">
              приоритет {{ formatPriority(data.decision.priority) }}
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
              class="font-normal"
              :title="reason.code"
            >
              {{ decisionReasonLabel(reason.code) }}<template v-if="reason.detail">: {{ reason.detail }}</template>
            </Badge>
          </div>
        </CardContent>
      </Card>
    </template>
  </section>
</template>
