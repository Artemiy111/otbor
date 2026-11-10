<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { BLOCKED_REASON_LABELS, decisionReasonDetail, describeKitAnswer } from "@otbor/contract"
import { ArrowRight, CircleAlert, LoaderCircle, Undo2 } from "@lucide/vue"
import { applicationApi, applicationKeys, applicationLinkFrom, contextFromSearch, filterToSearch } from "@/entities/application"
import {
  autoApplyApi,
  employerResponse,
  humanStatus,
  humanizeError,
  HumanStatusBadge,
  modeLabel,
  modeTone,
  reasonAdvice,
  retryClock
} from "@/entities/auto-apply"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { ApplicationActionBar, useApplicationActions } from "@/features/application-actions"
import { UnsavedChangesSheet, useUnsavedGuard } from "@/features/filter-target"
import { RefreshButton } from "@/features/refresh-button"
import { AnswersEditor, kitProblems, missingParts, problemsByQuestion, useKitDraft, type KitProblem, type LetterRule } from "@/features/vacancy-apply"
import {
  decisionReasonLabel,
  cn,
  describeError,
  formatAge,
  formatDate,
  formatPriority,
  locationSearch,
  statusLabel,
  toneClasses,
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
  TableRow,
  Textarea,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const props = defineProps<{ id: string }>()

const POLL_MS = 5000
const MAX_LETTER = 10_000

const query = useQuery({
  key: () => applicationKeys.detail(props.id),
  query: () => applicationApi.get(props.id)
})
const data = computed(() => query.data.value)
const application = computed(() => data.value?.application ?? null)
const status = computed(() => (application.value === null ? null : humanStatus(application.value, progress.value?.stage ?? null)))

/* ---- ход автоотклика: этап, последняя ошибка, можно ли повторить письмо ------------------ */

const progressQuery = useQuery({
  key: () => ["auto-apply", "application", props.id],
  query: () => autoApplyApi.progress({ applicationId: props.id }),
  enabled: () =>
    application.value?.autoRun != null && !["submitted", "skipped"].includes(application.value?.state ?? "")
})
const progress = computed(() => progressQuery.data.value?.items[0] ?? null)

useIntervalFn(() => {
  if (document.hidden) return
  const moving = status.value?.moving === true
  if (moving && query.asyncStatus.value === "idle") void query.refetch()
  if (moving && progressQuery.asyncStatus.value === "idle" && progressQuery.status.value !== "pending") void progressQuery.refetch()
}, POLL_MS)

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

/* ---- очередь: «Следующий отклик» из того же списка -------------------------------------- */

const context = computed(() => contextFromSearch(locationSearch.value))
const queueQuery = useQuery({
  key: () => ["applications", "queue", filterToSearch(context.value ?? { tab: "all", state: null, reason: null, mode: null, account: null, q: "" })] as const,
  query: () =>
    applicationApi.search({
      filter: context.value!,
      hhAccountId: context.value!.account && context.value!.account !== "all" ? context.value!.account : undefined,
      limit: 200,
      offset: 0
    }),
  enabled: () => context.value !== null
})
const queue = computed(() => queueQuery.data.value?.items ?? [])
/** Где отклик стоял в очереди в последний раз: когда он выйдет из фильтра, на его место сдвинется следующий. */
const lastIndex = ref(0)
watch(
  [queue, () => props.id],
  () => {
    const index = queue.value.findIndex((item) => item.id === props.id)
    if (index >= 0) lastIndex.value = index
  },
  { immediate: true }
)
watch(
  () => props.id,
  () => {
    lastIndex.value = 0
    done.value = false
    problems.value = []
  }
)
const nextId = computed<string | null>(() => {
  if (context.value === null) return null
  const items = queue.value
  const index = items.findIndex((item) => item.id === props.id)
  const candidate = index >= 0 ? items[index + 1] : items[Math.min(lastIndex.value, items.length - 1)]
  return candidate !== undefined && candidate.id !== props.id ? candidate.id : null
})
const position = computed(() => {
  const index = queue.value.findIndex((item) => item.id === props.id)
  const total = queueQuery.data.value?.total
  return index >= 0 && total !== undefined ? `${index + 1} из ${total}` : null
})
const listHref = computed(() => {
  const search = context.value === null ? "" : filterToSearch(context.value)
  return search === "" ? "/applications" : `/applications?${search}`
})

const actions = useApplicationActions()
/** Оператор что-то сделал с этим откликом: теперь «Следующий» - главная кнопка. */
const done = ref(false)
const onDone = async () => {
  done.value = true
  await Promise.all([query.refetch(), queueQuery.refetch()])
}

/* ---- письмо и ответы ------------------------------------------------------------------ */

const toast = useToast()
const kit = computed(() => data.value?.kit ?? null)
const kitAnswers = computed(() => (kit.value?.answers ?? []).map((raw) => describeKitAnswer(raw, data.value?.form?.form)))
/** Редактировать можно, пока отклик ждёт человека: у ждущего раннера кит принадлежит раннеру. */
const editable = computed(() => application.value?.state === "draft" || application.value?.state === "needs_human")

const form = computed(() => data.value?.form?.form ?? null)
const questions = computed(() => form.value?.questions ?? [])
const hints = computed(() => data.value?.form?.hints ?? [])
const letterRule = computed<LetterRule>(() => form.value?.coverLetter ?? "unknown")

const draft = useKitDraft({
  applicationId: () => props.id,
  questions: () => questions.value,
  hints: () => hints.value,
  kit: () => kit.value
})
const guard = useUnsavedGuard(draft.dirty)

/** Отказ сервера по вопросам: показывается у вопроса, пока его не поправят. */
const problems = ref<ReadonlyArray<KitProblem>>([])
const problemMap = computed(() => problemsByQuestion(problems.value))
const generalProblems = computed(() => problemMap.value.get("") ?? [])
const onProblems = (error: unknown) => {
  problems.value = kitProblems(error)
}
const changeAnswer = (questionId: string, value: Parameters<typeof draft.change>[1]) => {
  draft.change(questionId, value)
  if (problems.value.some((problem) => problem.questionId === questionId)) {
    problems.value = problems.value.filter((problem) => problem.questionId !== questionId)
  }
}

const missing = computed(() =>
  editable.value
    ? missingParts({
        letter: draft.letter.value,
        letterRule: letterRule.value,
        questions: questions.value,
        answers: draft.answers
      })
    : []
)

const saving = ref(false)
/** Сохраняет письмо и ответы; возвращает хеш формы, под который кит сохранён. */
const saveKit = async (): Promise<string | null> => {
  const current = kit.value
  if (current === null) return null
  const formHash = form.value?.formHash ?? current.formHash
  const text = draft.letter.value.trim()
  await actions.saveLetter({
    id: props.id,
    formHash,
    letter: text === "" ? null : text,
    answers: draft.answersToSave()
  })
  await query.refetch()
  problems.value = []
  return formHash
}
const save = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await saveKit()
    toast.success("Письмо и ответы сохранены")
  } catch (cause) {
    toast.error("Не удалось сохранить", { description: describeError(cause) })
  } finally {
    saving.value = false
  }
}
const revert = () => {
  draft.hydrate()
  problems.value = []
}

/* ---- пояснение: что с откликом и что делать ---------------------------------------------- */

const attemptMessage = computed(() => {
  const failed = [...(data.value?.attempts ?? [])].reverse().find((attempt) => attempt.exit?.message)
  return failed?.exit?.message ?? null
})
/** Сырой текст последней ошибки: из хода автоотклика, иначе из последней попытки. */
const rawError = computed(() => progress.value?.lastError ?? attemptMessage.value ?? null)
const errorText = computed(() => humanizeError(rawError.value))

const reasonText = computed(() => {
  const code = application.value?.blockedReason
  if (code === null || code === undefined) return null
  const text = (BLOCKED_REASON_LABELS as Readonly<Record<string, string>>)[code] ?? code
  return text.charAt(0).toUpperCase() + text.slice(1)
})
const advice = computed(
  () => reasonAdvice(application.value?.blockedReason) ?? "Повторите попытку или пропустите отклик."
)
const ageOf = (value: string | null | undefined): string => {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? "" : `${formatAge(Math.max(0, (Date.now() - time) / 1000))} назад`
}
const retryText = computed(() => {
  const at = application.value?.retryAt
  return at ? retryClock(at, new Date()) : null
})
const response = computed(() => (application.value === null ? null : employerResponse(application.value)))

const phaseTone = computed(() => {
  const phase = status.value?.phase
  if (phase === "sent") return "success"
  if (application.value?.state === "failed") return "danger"
  if (phase === "attention") return application.value?.state === "draft" ? "neutral" : "warning"
  if (phase === "active") return "info"
  return "neutral"
})

/* ---- служебное -------------------------------------------------------------------------- */

const num = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toLocaleString("ru-RU")
const harnessNames: Record<string, string> = { claude: "Claude Code", opencode: "OpenCode" }
const writer = computed(() => {
  const writing = data.value?.writing
  if (!kit.value) return null
  const model = writing?.modelId ?? writing?.model ?? kit.value.model ?? null
  const harness = writing?.harness ?? null
  return {
    harness,
    harnessName: harness === null ? null : (harnessNames[harness] ?? harness),
    model,
    effort: writing?.effort ?? null,
    tokens: num(writing?.totalTokens),
    duration:
      writing?.durationMs === null || writing?.durationMs === undefined
        ? null
        : `${(writing.durationMs / 1000).toFixed(1)} с`
  }
})
const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `$${value.toFixed(4)}`
const subtitle = computed(() => application.value?.employerName ?? "Компания не указана")
</script>

<template>
  <section class="max-lg:pb-28">
    <PageHeader
      :title="application?.vacancyTitle ?? 'Отклик'"
      :description="application ? subtitle : undefined"
      back-to="/applications"
      back-label="Отклики"
    >
      <template #actions>
        <HumanStatusBadge v-if="status" :status="status" :show-detail="false" />
        <Badge v-if="application" :variant="modeTone(application.autoRun)">{{ modeLabel(application.autoRun) }}</Badge>
        <Button v-if="application" as-child variant="outline" size="sm">
          <a :href="vacancyPath(application.vacancyId)">Вакансия</a>
        </Button>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отклик</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-3">
        {{ describeError(query.error.value) }}
        <Button size="sm" variant="outline" @click="query.refetch()">Повторить</Button>
      </AlertDescription>
    </Alert>

    <!-- Загрузка: каркас той же формы, что и готовая страница -->
    <div v-if="query.isPending.value" class="space-y-4" aria-busy="true">
      <Skeleton class="h-14 w-full" />
      <Skeleton class="h-24 w-full" />
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton class="h-80 w-full" />
        <Skeleton class="h-56 w-full" />
      </div>
    </div>

    <template v-else-if="data && application && status">
      <!-- Панель действий: сверху под шапкой на широком экране, снизу на телефоне -->
      <div
        class="z-10 border-border bg-background/95 backdrop-blur max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:border-t max-lg:px-3 max-lg:py-3 lg:sticky lg:top-14 lg:-mx-1 lg:mb-4 lg:rounded-lg lg:border lg:px-4 lg:py-3"
        role="region"
        aria-label="Действия с откликом"
      >
        <ApplicationActionBar
          :application="application"
          :kit-form-hash="kit?.formHash ?? null"
          :letter-retryable="progress?.retryable === true"
          :unsaved="draft.dirty.value"
          :send-blocker="missing.length > 0 ? missing.join(', ') : null"
          :save-first="saveKit"
          @problems="onProblems"
          @done="onDone"
        >
          <template v-if="context !== null" #next>
            <Button v-if="nextId" as-child :variant="done ? 'default' : 'outline'" class="ml-auto">
              <a :href="applicationLinkFrom(nextId, context)">
                Следующий отклик
                <ArrowRight class="size-4" />
              </a>
            </Button>
            <Button v-else as-child variant="outline" class="ml-auto">
              <a :href="listHref">{{ done ? "Очередь пуста, к списку" : "К списку" }}</a>
            </Button>
          </template>
        </ApplicationActionBar>
        <p v-if="position" class="mt-1 text-xs text-muted-foreground tabular-nums">Отклик {{ position }} в выбранном списке</p>
      </div>

      <!-- Что с откликом и что делать -->
      <div :class="cn('mb-4 rounded-lg border p-4 text-sm', toneClasses(phaseTone).border, toneClasses(phaseTone).bg)">
        <template v-if="application.state === 'needs_human' || application.state === 'failed'">
          <h2 :class="cn('text-sm font-semibold', toneClasses(phaseTone).text)">
            {{ application.state === "failed" ? "Отклик закончился ошибкой" : "Отклик ждёт вашего участия" }}
          </h2>
          <dl class="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt class="text-muted-foreground">Что остановило</dt>
            <dd>{{ reasonText ?? "Причина не указана" }}</dd>
            <template v-if="errorText">
              <dt class="text-muted-foreground">Последняя ошибка</dt>
              <dd>{{ errorText }}</dd>
            </template>
            <dt class="text-muted-foreground">С каких пор</dt>
            <dd class="tabular-nums">{{ formatDate(application.updatedAt) }} <span class="text-muted-foreground">({{ ageOf(application.updatedAt) }})</span></dd>
            <dt class="text-muted-foreground">Следующая попытка</dt>
            <dd>{{ retryText ? `автоматически в ${retryText}` : "автоматической не будет: решение за вами" }}</dd>
            <dt class="text-muted-foreground">Что делать</dt>
            <dd class="font-medium">{{ advice }}</dd>
          </dl>
        </template>

        <template v-else-if="application.state === 'draft'">
          <h2 class="text-sm font-semibold">Черновик ждёт вашей отправки</h2>
          <p class="mt-1 text-muted-foreground">
            Проверьте письмо и ответы ниже, затем нажмите «Отправить отклик». Форма на hh прочитается заново перед отправкой.
          </p>
        </template>

        <template v-else-if="application.state === 'preparing' || application.state === 'queued' || application.state === 'submitting'">
          <h2 :class="cn('text-sm font-semibold', toneClasses('info').text)">{{ status.label }}</h2>
          <p v-if="progress?.stageDetail" class="mt-1">{{ progress.stageDetail }}</p>
          <p v-else-if="application.state === 'queued'" class="mt-1 text-muted-foreground">
            Место в дневном лимите занято, отправка поставлена в очередь.
          </p>
          <p v-else-if="application.state === 'submitting'" class="mt-1 text-muted-foreground">
            Отклик отправляется на hh.ru. Страница обновится сама.
          </p>
          <p v-if="status.detail || retryText" class="mt-1 text-muted-foreground">
            <template v-if="reasonText">{{ reasonText }}. </template>
            <template v-if="retryText">Следующая попытка в {{ retryText }}.</template>
            <template v-if="(application.autoRetries ?? 0) > 0"> Автоповторов потрачено: {{ application.autoRetries }}.</template>
          </p>
        </template>

        <template v-else-if="application.state === 'submitted'">
          <div class="flex flex-wrap items-center gap-3">
            <h2 :class="cn('text-sm font-semibold', toneClasses('success').text)">
              Отклик отправлен<template v-if="application.hhRespondedAt"> {{ formatDate(application.hhRespondedAt) }}</template>
            </h2>
          </div>
          <div class="mt-3">
            <div class="text-xs text-muted-foreground">Ответ работодателя на hh</div>
            <Badge v-if="response" :variant="response.tone" class="mt-1 px-3 py-1 text-sm">{{ response.label }}</Badge>
            <p v-else class="mt-1 text-muted-foreground">hh пока ничего не сообщил. Статус обновляется синхронизацией откликов.</p>
          </div>
          <p v-if="application.origin === 'imported'" class="mt-2 text-xs text-muted-foreground">
            Этот отклик вы отправили на hh.ru сами, он добавлен синхронизацией.
          </p>
        </template>

        <template v-else>
          <h2 class="text-sm font-semibold">Отклик пропущен</h2>
          <p class="mt-1 text-muted-foreground">Он не будет отправлен.</p>
        </template>
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <AccountChip
          :account-id="application.hhAccountId"
          :accounts="accountsQuery.data.value ?? []"
          :resume-ids="[application.resumeId]"
          :resumes="resumesQuery.data.value ?? []"
        />
        <span>создан {{ formatDate(application.createdAt) }}</span>
        <span>обновлён {{ formatDate(application.updatedAt) }}</span>
      </div>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <!-- Основное: письмо и ответы -->
        <div class="min-w-0 space-y-6">
          <template v-if="kit">
            <section>
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-sm font-semibold">Письмо</h2>
                <span v-if="editable" class="text-xs text-muted-foreground">
                  <template v-if="letterRule === 'required'">обязательно</template>
                  <template v-else-if="letterRule === 'optional'">по желанию</template>
                  <template v-else-if="letterRule === 'absent'">hh не принимает письмо</template>
                </span>
              </div>
              <template v-if="editable">
                <Textarea
                  v-model="draft.letter.value"
                  class="min-h-48 text-sm leading-relaxed"
                  :maxlength="MAX_LETTER"
                  :disabled="saving || letterRule === 'absent'"
                  aria-label="Текст письма"
                />
                <div class="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                  {{ draft.letter.value.length }} / {{ MAX_LETTER }}
                </div>
              </template>
              <div
                v-else
                class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-5 py-4 text-sm leading-relaxed"
              >{{ kit.letter ?? "Письмо не подготовлено." }}</div>
              <p v-if="writer?.model" class="mt-2 text-xs text-muted-foreground">Письмо написала модель {{ writer.model }}.</p>
            </section>

            <section>
              <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="flex items-baseline gap-2 text-sm font-semibold">
                  Ответы на форму
                  <span class="text-xs font-normal text-muted-foreground tabular-nums">{{ editable ? questions.length : kit.answers.length }}</span>
                </h2>
              </div>
              <p v-if="editable && form && kit.formHash !== form.formHash" :class="cn('mb-2 text-xs', toneClasses('warning').text)">
                Вопросы на hh изменились после сохранения черновика. Проверьте ответы и сохраните их заново.
              </p>
              <ul
                v-if="generalProblems.length > 0"
                :class="cn('mb-2 space-y-0.5 rounded-md border p-3 text-sm', toneClasses('danger').border, toneClasses('danger').bg, toneClasses('danger').text)"
                role="alert"
              >
                <li v-for="text in generalProblems" :key="text">{{ text }}</li>
              </ul>
              <AnswersEditor
                v-if="editable && questions.length > 0"
                id-prefix="app"
                :questions="questions"
                :answers="draft.answers"
                :hints="hints"
                :problems="problemMap"
                :disabled="saving"
                @change="changeAnswer"
              />
              <ol v-else-if="kit.answers.length > 0" class="space-y-3">
                <li
                  v-for="(answer, index) in kitAnswers"
                  :key="index"
                  class="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div class="flex gap-3 border-b border-border bg-muted/50 px-4 py-2.5">
                    <span
                      class="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground"
                    >{{ index + 1 }}</span>
                    <p class="text-sm font-medium leading-snug text-foreground">{{ answer.question }}</p>
                  </div>
                  <div class="whitespace-pre-wrap px-4 py-3 pl-12 text-sm leading-relaxed">
                    {{ answer.answer }}
                  </div>
                </li>
              </ol>
              <p v-else class="text-sm text-muted-foreground">У этой вакансии нет вопросов в форме отклика.</p>
            </section>

            <!-- Одна кнопка на письмо и ответы; на широком экране панель держится у нижнего края -->
            <div
              v-if="editable"
              :class="
                cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3 lg:sticky lg:bottom-4',
                  draft.dirty.value ? toneClasses('warning').border : 'border-border'
                )
              "
            >
              <Button :disabled="saving || !draft.dirty.value" @click="save">
                <LoaderCircle v-if="saving" class="size-4 animate-spin" />
                Сохранить письмо и ответы
              </Button>
              <Button v-if="draft.dirty.value" variant="ghost" :disabled="saving" @click="revert">
                <Undo2 class="size-4" />
                Вернуть сохранённое
              </Button>
              <span
                :class="cn('text-sm', draft.dirty.value ? toneClasses('warning').text : 'text-muted-foreground')"
                role="status"
              >
                {{ draft.dirty.value ? "Есть несохранённые изменения." : "Всё сохранено." }}
              </span>
              <span v-if="missing.length > 0" class="text-xs text-muted-foreground">Не заполнено: {{ missing.join(", ") }}.</span>
              <span v-if="kit" class="ml-auto text-xs text-muted-foreground tabular-nums">Сохранено {{ formatDate(kit.createdAt) }}</span>
            </div>
          </template>

          <EmptyState
            v-else
            :title="application.state === 'preparing' ? 'Письмо ещё готовится' : 'Письмо и ответы не подготовлены'"
            :description="
              editable
                ? 'Напишите письмо на странице вакансии: там же можно составить его с помощью модели.'
                : 'Письмо и ответы появятся, когда подготовка закончится.'
            "
          >
            <Button v-if="editable" as-child variant="outline" size="sm">
              <a :href="vacancyPath(application.vacancyId)">Открыть вакансию</a>
            </Button>
          </EmptyState>

          <!-- Служебное: то, что нужно только при разборе сбоев -->
          <details class="group rounded-lg border border-border bg-card">
            <summary
              class="cursor-pointer select-none rounded-lg px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Технические детали
            </summary>
            <div class="space-y-5 border-t border-border p-4 text-sm">
              <dl class="grid gap-x-6 gap-y-1.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt class="text-muted-foreground">Номер отклика</dt>
                <dd class="break-all font-mono text-xs">{{ application.id }}</dd>
                <template v-if="kit">
                  <dt class="text-muted-foreground">Версия формы</dt>
                  <dd class="break-all font-mono text-xs">{{ kit.formHash }}</dd>
                </template>
                <dt class="text-muted-foreground">Состояние в системе</dt>
                <dd class="font-mono text-xs">{{ application.state }}<template v-if="application.blockedReason"> · {{ application.blockedReason }}</template></dd>
                <template v-if="rawError">
                  <dt class="text-muted-foreground">Текст ошибки</dt>
                  <dd class="whitespace-pre-wrap break-words font-mono text-xs">{{ rawError }}</dd>
                </template>
              </dl>

              <div v-if="writer" class="flex items-center gap-3">
                <HarnessLogo :harness="writer.harness" class="size-9" />
                <div class="min-w-0 text-xs text-muted-foreground">
                  <div class="truncate font-mono text-sm font-semibold text-foreground">{{ writer.model ?? "Модель не указана" }}</div>
                  <div>
                    {{ writer.harnessName ?? "исполнитель не указан" }}
                    <template v-if="writer.effort"> · {{ writer.effort }}</template>
                    · токенов {{ writer.tokens ?? "—" }} · {{ writer.duration ?? "—" }} · {{ cost(kit?.costUsd) }}
                  </div>
                </div>
              </div>

              <div v-if="progress?.writingJob?.resultText">
                <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ответ модели (не сохранён как письмо)
                </h3>
                <pre
                  class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
                >{{ progress.writingJob.resultText }}</pre>
              </div>

              <div>
                <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Попытки обработки <span class="tabular-nums">{{ data.attempts.length }}</span>
                </h3>
                <div v-if="data.attempts.length > 0" class="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>№</TableHead>
                        <TableHead>Этап</TableHead>
                        <TableHead>Итог</TableHead>
                        <TableHead>Исполнитель</TableHead>
                        <TableHead>Начата</TableHead>
                        <TableHead>Завершена</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="attempt in data.attempts" :key="attempt.id">
                        <TableCell class="tabular-nums">{{ attempt.seq }}</TableCell>
                        <TableCell>{{ statusLabel(attempt.stage) }}</TableCell>
                        <TableCell>
                          <StatusBadge v-if="attempt.exit" :value="attempt.exit.tag" />
                          <span v-else class="text-muted-foreground">—</span>
                          <div v-if="attempt.exit?.message" class="mt-1 text-xs text-muted-foreground">{{ attempt.exit.message }}</div>
                        </TableCell>
                        <TableCell class="font-mono text-xs">{{ attempt.harnessId ?? "—" }}</TableCell>
                        <TableCell class="whitespace-nowrap text-muted-foreground">{{ formatDate(attempt.startedAt) }}</TableCell>
                        <TableCell class="whitespace-nowrap text-muted-foreground">{{ formatDate(attempt.finishedAt) }}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <p v-else class="text-sm text-muted-foreground">Попыток обработки пока не было.</p>
              </div>
            </div>
          </details>
        </div>

        <!-- Сбоку: почему отклик создан -->
        <aside class="space-y-4">
          <div v-if="data.decision" class="rounded-lg border border-border bg-card p-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-sm font-semibold">Решение</h2>
              <StatusBadge :value="data.decision.verdict" />
            </div>
            <div class="mt-3 flex gap-6 text-sm">
              <div>
                <div class="font-semibold tabular-nums">{{ data.decision.fit }}</div>
                <div class="text-xs text-muted-foreground">соответствие</div>
              </div>
              <div>
                <div class="font-semibold tabular-nums">{{ formatPriority(data.decision.priority) }}</div>
                <div class="text-xs text-muted-foreground">приоритет</div>
              </div>
            </div>
            <div v-if="data.decision.reasons.length > 0" class="mt-3 flex flex-wrap gap-1">
              <Badge
                v-for="reason in data.decision.reasons"
                :key="reason.code + (reason.detail ?? '')"
                variant="secondary"
                class="h-auto max-w-full whitespace-normal break-words text-left font-normal"
              >
                {{ decisionReasonLabel(reason.code) }}<template v-if="reason.detail">: {{ decisionReasonDetail(reason, data.decision.createdAt) }}</template>
              </Badge>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">{{ formatDate(data.decision.createdAt) }}</p>
          </div>
          <p v-else class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Решения нет: отклик создан вручную или вашим выбором вакансии.
          </p>
        </aside>
      </div>
    </template>

    <UnsavedChangesSheet
      :open="guard.open.value"
      description="Письмо и ответы не сохранены. Если уйти сейчас, правки пропадут."
      @leave="guard.leave"
      @stay="guard.stay"
    />
  </section>
</template>
