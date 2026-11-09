<script setup lang="ts">
import { autoApplyApi, autoApplyStageMeta, autoRunLabel } from "@/entities/auto-apply"
import { computed, onBeforeUnmount } from "vue"
import { decisionReasonDetail, describeKitAnswer } from "@otbor/contract"
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
  EmptyState,
  HarnessLogo,
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

const props = defineProps<{ id: string }>()

const query = useQuery({
  key: () => applicationKeys.detail(props.id),
  query: () => applicationApi.get(props.id)
})

const data = computed(() => query.data.value)

const progressQuery = useQuery({
  key: () => ["auto-apply", "application", props.id],
  query: () => autoApplyApi.progress({ applicationId: props.id }),
  enabled: () => data.value?.application.autoRun != null && !data.value?.kit
})
const progress = computed(() => progressQuery.data.value?.items[0] ?? null)
const poll = setInterval(() => {
  if (!document.hidden && progressQuery.asyncStatus.value === "idle" && data.value?.application.autoRun != null && !data.value?.kit) {
    void progressQuery.refetch()
  }
}, 5000)
onBeforeUnmount(() => clearInterval(poll))

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

const kitAnswers = computed(() =>
  (data.value?.kit?.answers ?? []).map((raw) => describeKitAnswer(raw, data.value?.form?.form))
)

const num = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toLocaleString("ru-RU")

/** Кто написал письмо и во что это обошлось; только известные факты. */
const writer = computed(() => {
  const kit = data.value?.kit
  const writing = data.value?.writing
  if (!kit) return null
  const alias = writing?.model ?? kit.model
  const model = writing?.modelId ?? alias ?? null
  const harness = writing?.harness ?? null
  const tokenParts = writing
    ? [
        writing.inputTokens !== null ? `вход ${num(writing.inputTokens)}` : null,
        writing.outputTokens !== null ? `выход ${num(writing.outputTokens)}` : null,
        writing.cachedReadTokens ? `кэш ${num(writing.cachedReadTokens)}` : null
      ].filter((part) => part !== null)
    : []
  return {
    harness,
    harnessName: harness === null ? null : (harnessNames[harness] ?? harness),
    model,
    alias: alias !== null && alias !== model ? alias : null,
    effort: writing?.effort ?? null,
    tokens: num(writing?.totalTokens),
    tokenDetail: tokenParts.join(" · "),
    duration:
      writing?.durationMs === null || writing?.durationMs === undefined
        ? null
        : `${(writing.durationMs / 1000).toFixed(1)} с`
  }
})

const harnessNames: Record<string, string> = { claude: "Claude Code", opencode: "OpenCode" }

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
        <Badge v-if="data?.application.autoRun" :variant="data.application.autoRun === 'auto' ? 'info' : 'outline'">
          {{ autoRunLabel(data.application.autoRun) }}
        </Badge>
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

    <div v-if="query.isPending.value" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Skeleton class="h-96 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <AccountChip
          :account-id="data.application.hhAccountId"
          :accounts="accountsQuery.data.value ?? []"
          :resume-ids="[data.application.resumeId]"
          :resumes="resumesQuery.data.value ?? []"
        />
        <span>создан {{ formatDate(data.application.createdAt) }}</span>
        <span>обновлён {{ formatDate(data.application.updatedAt) }}</span>
        <span>попыток: {{ data.attempts.length }}</span>
      </div>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <!-- Основное: письмо и ответы -->
        <div class="min-w-0 space-y-6">
          <template v-if="data.kit">
            <section>
              <h2 class="mb-2 text-sm font-semibold">Письмо</h2>
              <div
                class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-5 py-4 text-sm leading-relaxed"
              >{{ data.kit.letter ?? "Письмо не подготовлено." }}</div>
            </section>

            <section>
              <h2 class="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                Ответы на форму
                <span class="text-xs font-normal text-muted-foreground">{{ data.kit.answers.length }}</span>
              </h2>
              <ol v-if="data.kit.answers.length > 0" class="space-y-3">
                <li
                  v-for="(answer, index) in kitAnswers"
                  :key="index"
                  class="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div class="flex gap-3 border-b border-border bg-muted/50 px-4 py-2.5">
                    <span
                      class="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
                    >{{ index + 1 }}</span>
                    <p class="text-sm font-medium leading-snug text-foreground">{{ answer.question }}</p>
                  </div>
                  <div class="whitespace-pre-wrap px-4 py-3 pl-12 text-sm leading-relaxed">
                    {{ answer.answer }}
                  </div>
                </li>
              </ol>
              <p v-else class="text-sm text-muted-foreground">Ответов на вопросы нет.</p>
            </section>
          </template>

          <section v-else-if="progress" class="space-y-3 rounded-lg border border-border bg-card p-4">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{{ autoApplyStageMeta(progress.stage).label }}</Badge>
              <span class="text-sm text-muted-foreground">{{ progress.stageDetail }}</span>
            </div>
            <p v-if="progress.lastError" class="text-sm text-destructive">{{ progress.lastError }}</p>
            <template v-if="progress.writingJob?.resultText">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ответ модели (не сохранён как письмо)
              </h3>
              <pre
                class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
              >{{ progress.writingJob.resultText }}</pre>
            </template>
          </section>
          <EmptyState
            v-else
            title="Комплект не подготовлен"
            description="Письмо и ответы появятся после генерации."
          />

          <section>
            <h2 class="mb-2 flex items-baseline gap-2 text-sm font-semibold">
              Попытки
              <span class="text-xs font-normal text-muted-foreground">что harness сообщил после каждой</span>
            </h2>
            <div v-if="data.attempts.length > 0" class="overflow-hidden rounded-lg border border-border bg-card">
              <Table>
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
            </div>
            <p v-else class="text-sm text-muted-foreground">Harness ещё не брал этот отклик.</p>
          </section>
        </div>

        <!-- Сбоку: кто писал и почему создан -->
        <aside class="space-y-4">
          <div v-if="writer" class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="flex items-center gap-3 p-4">
              <HarnessLogo :harness="writer.harness" class="size-11" />
              <div class="min-w-0">
                <div class="truncate font-mono text-sm font-semibold" :title="writer.model ?? undefined">
                  {{ writer.model ?? "Модель не указана" }}
                </div>
                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{{ writer.harnessName ?? "харнес неизвестен" }}</span>
                  <Badge v-if="writer.effort" variant="secondary" class="px-1.5 py-0 font-normal">
                    {{ writer.effort }}
                  </Badge>
                </div>
              </div>
            </div>
            <dl class="grid grid-cols-3 divide-x divide-border border-t border-border text-center">
              <div class="px-2 py-2.5">
                <dd class="text-sm font-semibold tabular-nums">{{ writer.tokens ?? "—" }}</dd>
                <dt class="text-[11px] text-muted-foreground">токенов</dt>
              </div>
              <div class="px-2 py-2.5">
                <dd class="text-sm font-semibold tabular-nums">{{ writer.duration ?? "—" }}</dd>
                <dt class="text-[11px] text-muted-foreground">время</dt>
              </div>
              <div class="px-2 py-2.5">
                <dd class="text-sm font-semibold tabular-nums">{{ cost(data.kit?.costUsd) }}</dd>
                <dt class="text-[11px] text-muted-foreground">стоимость</dt>
              </div>
            </dl>
            <p
              v-if="writer.tokenDetail"
              class="border-t border-border px-4 py-2 text-[11px] text-muted-foreground"
            >
              {{ writer.tokenDetail }}
            </p>
            <p
              v-if="data.kit"
              class="border-t border-border px-4 py-2 font-mono text-[11px] text-muted-foreground"
              title="Хеш формы, под которую подготовлен комплект"
            >
              форма {{ data.kit.formHash }}
            </p>
          </div>

          <div v-if="data.decision" class="rounded-lg border border-border bg-card p-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-sm font-semibold">Решение</h2>
              <StatusBadge :value="data.decision.verdict" raw />
            </div>
            <div class="mt-3 flex gap-6 text-sm">
              <div>
                <div class="font-semibold tabular-nums">{{ data.decision.fit }}</div>
                <div class="text-[11px] text-muted-foreground">соответствие</div>
              </div>
              <div>
                <div class="font-semibold tabular-nums">{{ formatPriority(data.decision.priority) }}</div>
                <div class="text-[11px] text-muted-foreground">приоритет</div>
              </div>
            </div>
            <div v-if="data.decision.reasons.length > 0" class="mt-3 flex flex-wrap gap-1">
              <Badge
                v-for="reason in data.decision.reasons"
                :key="reason.code + (reason.detail ?? '')"
                variant="secondary"
                class="font-normal"
                :title="reason.code"
              >
                {{ decisionReasonLabel(reason.code) }}<template v-if="reason.detail">: {{ decisionReasonDetail(reason, data.decision.createdAt) }}</template>
              </Badge>
            </div>
            <p class="mt-3 text-[11px] text-muted-foreground">{{ formatDate(data.decision.createdAt) }}</p>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>
