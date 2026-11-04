<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { CircleAlert, CircleCheck, LoaderCircle, Send } from "@lucide/vue"
import type {
  ApplicationRecord,
  FormQuestion,
  HhAccountRecord,
  KitAnswer,
  ResumeRecord,
  StoredHint,
  VacancyDetail
} from "@otbor/contract"
import { applicationApi, applicationKeys } from "@/entities/application"
import { describeError, formatDate, statusLabel } from "@/shared/lib"
import AccountResumePicker from "./AccountResumePicker.vue"
import { Alert, AlertDescription, AlertTitle, Badge, Button, StatusBadge, Textarea } from "@/shared/ui"

const props = defineProps<{
  vacancyId: string
  data: VacancyDetail
  applications: ReadonlyArray<ApplicationRecord>
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
}>()

const emit = defineEmits<{ changed: [] }>()

/* ---- account + resume (chosen on the page, shared with skills/keywords) --- */

const accountId = defineModel<string>("accountId", { required: true })
const resumeId = defineModel<string>("resumeId", { required: true })

const sent = computed(() =>
  props.applications
    .filter((application) => ["submitted", "submitting", "queued"].includes(application.state))
    .map((application) => ({
      accountId: application.hhAccountId,
      resumeId: application.resumeId ?? null
    }))
)

const existing = computed(() => {
  const candidates = props.applications.filter(
    (application) =>
      application.hhAccountId === accountId.value &&
      (application.resumeId ?? "") === resumeId.value
  )
  return candidates.find((application) => application.state !== "skipped") ?? candidates[0] ?? null
})

/* ---- prepared application ------------------------------------------------ */

const detailQuery = useQuery({
  key: () => applicationKeys.detail(existing.value?.id ?? "none"),
  query: () => applicationApi.get(existing.value!.id),
  enabled: () => existing.value !== null
})
const detail = computed(() => (existing.value === null ? null : (detailQuery.data.value ?? null)))
const state = computed(() => detail.value?.application.state ?? existing.value?.state ?? null)
const form = computed(() => detail.value?.form?.form ?? null)
const hints = computed<ReadonlyArray<StoredHint>>(() => detail.value?.form?.hints ?? [])
const questions = computed<ReadonlyArray<FormQuestion>>(() => form.value?.questions ?? [])

const waitingForForm = computed(
  () => existing.value !== null && form.value === null && state.value === "draft"
)
const poller = useIntervalFn(
  () => {
    void detailQuery.refetch()
  },
  3000,
  { immediate: false }
)
watch(
  waitingForForm,
  (waiting) => (waiting ? poller.resume() : poller.pause()),
  { immediate: true }
)

const finished = computed(() =>
  ["submitted", "submitting", "queued"].includes(state.value ?? "")
)

/* ---- letter and answers -------------------------------------------------- */

interface AnswerState {
  optionIds: Array<string>
  text: string
}

const letter = ref("")
const answers = reactive<Record<string, AnswerState>>({})
const initializedFor = ref<string | null>(null)

const hintFor = (questionId: string) => hints.value.find((hint) => hint.questionId === questionId)

watch(
  detail,
  (value) => {
    if (value === null || value.form === undefined || value.form === null) return
    const key = `${value.application.id}:${value.form.form.formHash}:${value.kit?.id ?? ""}`
    if (initializedFor.value === key) return
    initializedFor.value = key
    for (const name of Object.keys(answers)) delete answers[name]
    const saved = new Map(
      (value.kit?.answers ?? [])
        .filter((item): item is Extract<KitAnswer, { questionId: string }> => "questionId" in item)
        .map((item) => [item.questionId, item])
    )
    for (const question of value.form.form.questions) {
      const kitAnswer = saved.get(question.id)
      const hint = value.form.hints.find((item) => item.questionId === question.id)
      answers[question.id] = {
        optionIds: [...(kitAnswer?.optionIds ?? hint?.optionIds ?? [])],
        text: kitAnswer?.text ?? hint?.text ?? ""
      }
    }
    if (value.kit?.letter) letter.value = value.kit.letter
  },
  { immediate: true }
)

const answerOf = (id: string): AnswerState => (answers[id] ??= { optionIds: [], text: "" })

const toggleOption = (question: FormQuestion, optionId: string) => {
  const answer = answerOf(question.id)
  if (question.kind === "single") {
    answer.optionIds = [optionId]
    return
  }
  answer.optionIds = answer.optionIds.includes(optionId)
    ? answer.optionIds.filter((item) => item !== optionId)
    : [...answer.optionIds, optionId]
}

const isAnswered = (question: FormQuestion): boolean => {
  const answer = answerOf(question.id)
  return question.kind === "single" || question.kind === "multiple"
    ? answer.optionIds.length > 0
    : answer.text.trim() !== ""
}

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|")

const buildAnswers = (): Array<KitAnswer> => {
  const out: Array<KitAnswer> = []
  for (const question of questions.value) {
    if (!isAnswered(question)) continue
    const answer = answerOf(question.id)
    const choice = question.kind === "single" || question.kind === "multiple"
    const hint = hintFor(question.id)
    const asHinted =
      hint !== undefined &&
      (choice
        ? sameSet(answer.optionIds, hint.optionIds ?? [])
        : answer.text.trim() === (hint.text ?? "").trim())
    out.push({
      questionId: question.id,
      ...(choice ? { optionIds: [...answer.optionIds] } : { text: answer.text.trim() }),
      source: asHinted ? "hint" : "human",
      hard: asHinted ? hint.hard : false,
      needsHuman: false
    })
  }
  return out
}

/* ---- what is missing ----------------------------------------------------- */

const letterRule = computed<"required" | "optional" | "absent" | "unknown">(() => {
  if (form.value !== null) return form.value.coverLetter
  return props.data.facts?.hh?.letterRequired === true ? "required" : "unknown"
})

const missing = computed(() => {
  const out: Array<string> = []
  if (letterRule.value === "required" && letter.value.trim() === "") out.push("сопроводительное письмо")
  questions.value.forEach((question, index) => {
    if (question.required && !isAnswered(question)) out.push(`вопрос ${index + 1}`)
  })
  return out
})

const needsOwnAnswer = computed(() =>
  questions.value.filter((question) => question.kind === "code").length
)

/* ---- actions ------------------------------------------------------------- */

const busy = ref<"prepare" | "save" | "send" | null>(null)
const errorText = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirming = ref(false)

const explain = (error: unknown): string => {
  const problems = (error as { problems?: ReadonlyArray<unknown> } | null)?.problems
  if (Array.isArray(problems) && problems.length > 0) {
    return problems
      .map((problem) =>
        typeof problem === "string"
          ? problem
          : String((problem as { message?: unknown })?.message ?? JSON.stringify(problem))
      )
      .join("; ")
  }
  return describeError(error)
}

const prepare = async () => {
  if (accountId.value === "" || busy.value !== null) return
  busy.value = "prepare"
  errorText.value = null
  try {
    await applicationApi.createManual({
      vacancyId: props.vacancyId,
      hhAccountId: accountId.value,
      resumeId: resumeId.value || undefined
    })
    emit("changed")
  } catch (error) {
    errorText.value = explain(error)
  } finally {
    busy.value = null
  }
}

const saveKit = async () => {
  const current = detail.value
  if (current === null || current.form === undefined || current.form === null) return
  await applicationApi.setKit({
    applicationId: current.application.id,
    formHash: current.form.form.formHash,
    letter: letter.value.trim() === "" ? null : letter.value.trim(),
    answers: buildAnswers()
  })
}

const saveDraft = async () => {
  if (busy.value !== null) return
  busy.value = "save"
  errorText.value = null
  notice.value = null
  try {
    await saveKit()
    await detailQuery.refetch()
    notice.value = "Черновик сохранён."
  } catch (error) {
    errorText.value = explain(error)
  } finally {
    busy.value = null
  }
}

const send = async () => {
  const current = detail.value
  if (current === null || busy.value !== null) return
  busy.value = "send"
  errorText.value = null
  notice.value = null
  try {
    await saveKit()
    await applicationApi.approve(current.application.id)
    confirming.value = false
    await detailQuery.refetch()
    emit("changed")
    notice.value = "Отклик поставлен в очередь на отправку."
  } catch (error) {
    errorText.value = explain(error)
    confirming.value = false
  } finally {
    busy.value = null
  }
}

const maxLetter = 10_000
</script>

<template>
  <section class="space-y-4 rounded-lg border border-border bg-card p-4 text-sm">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-base font-semibold">Отклик</h2>
      <StatusBadge v-if="state" :value="state" />
    </div>

    <!-- who responds: one click opens, hover an account, click a resume -->
    <AccountResumePicker
      v-model:account-id="accountId"
      v-model:resume-id="resumeId"
      :accounts="accounts"
      :resumes="resumes"
      :sent="sent"
      :disabled="busy !== null"
    />

    <div v-if="data.facts?.hh?.test.hasTest || data.facts?.hh?.letterRequired" class="flex flex-wrap gap-1.5">
      <Badge v-if="data.facts?.hh?.letterRequired" variant="warning">hh требует письмо</Badge>
      <Badge v-if="data.facts?.hh?.test.hasTest" variant="warning">
        {{ data.facts.hh.test.required === false ? "тест необязательный" : "есть тест" }}
      </Badge>
    </div>

    <!-- already sent -->
    <Alert v-if="finished">
      <CircleCheck />
      <AlertTitle>{{ statusLabel(state ?? "") }}</AlertTitle>
      <AlertDescription>
        Этим аккаунтом с этим резюме на вакансию уже откликались
        <template v-if="existing">({{ formatDate(existing.updatedAt) }})</template>.
        Чтобы откликнуться другим резюме, выберите его выше.
      </AlertDescription>
    </Alert>

    <template v-else>
      <!-- not prepared -->
      <div v-if="existing === null" class="rounded-md border border-dashed border-border p-3 text-muted-foreground">
        Форма отклика с hh ещё не загружена. Нажмите «Загрузить форму» — otbor откроет её на hh
        и покажет вопросы теста, если они есть. Письмо можно писать уже сейчас.
      </div>
      <div v-else-if="waitingForForm" class="flex items-center gap-2 rounded-md border border-border p-3 text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />
        Загружаю форму отклика с hh…
      </div>
      <Alert v-else-if="state === 'needs_human' || state === 'failed'" variant="destructive">
        <CircleAlert />
        <AlertTitle>{{ statusLabel(state) }}</AlertTitle>
        <AlertDescription>Проверьте ответы и отправьте ещё раз, либо откройте отклик, чтобы увидеть попытки.</AlertDescription>
      </Alert>

      <!-- letter -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Сопроводительное письмо
          </span>
          <span class="text-xs text-muted-foreground">
            <template v-if="letterRule === 'required'">обязательно</template>
            <template v-else-if="letterRule === 'optional'">по желанию</template>
            <template v-else-if="letterRule === 'absent'">hh не принимает письмо</template>
            <template v-else>формат уточнится после загрузки формы</template>
          </span>
        </div>
        <Textarea
          v-model="letter"
          class="min-h-40 leading-relaxed"
          :maxlength="maxLetter"
          :disabled="letterRule === 'absent' || busy !== null"
          placeholder="Здравствуйте! Меня заинтересовала вакансия…"
        />
        <div class="text-right text-xs text-muted-foreground">{{ letter.length }} / {{ maxLetter }}</div>
      </div>

      <!-- test -->
      <div v-if="form !== null && questions.length > 0" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Тест работодателя ({{ questions.length }})
          </span>
          <span v-if="needsOwnAnswer > 0" class="text-xs text-amber-300">
            есть задание с кодом: ответьте сами
          </span>
        </div>
        <fieldset
          v-for="(question, index) in questions"
          :key="question.id"
          class="space-y-2 rounded-md border border-border p-3"
        >
          <legend class="px-1 text-sm font-medium">
            {{ index + 1 }}. {{ question.text }}
            <span v-if="question.required" class="text-red-300">*</span>
          </legend>
          <p v-if="hintFor(question.id)?.note" class="text-xs text-muted-foreground">
            Подсказка: {{ hintFor(question.id)?.note }}
          </p>

          <template v-if="question.kind === 'single' || question.kind === 'multiple'">
            <label
              v-for="option in question.options"
              :key="option.id"
              class="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/40"
            >
              <input
                :type="question.kind === 'single' ? 'radio' : 'checkbox'"
                :name="`q-${question.id}`"
                class="mt-0.5 size-4 accent-primary"
                :checked="answerOf(question.id).optionIds.includes(option.id)"
                @change="toggleOption(question, option.id)"
              />
              <span>{{ option.label }}</span>
            </label>
          </template>
          <Textarea
            v-else
            v-model="answerOf(question.id).text"
            :class="question.kind === 'code' ? 'min-h-32 font-mono text-xs' : 'min-h-20'"
            :maxlength="question.maxLength ?? undefined"
            :placeholder="question.kind === 'code' ? `Код${question.codeLanguage ? ` (${question.codeLanguage})` : ''}` : 'Ваш ответ'"
          />
        </fieldset>
      </div>
      <p v-else-if="form !== null" class="text-xs text-muted-foreground">
        У этой вакансии нет вопросов теста: нужно только письмо.
      </p>

      <!-- result -->
      <Alert v-if="errorText" variant="destructive">
        <CircleAlert />
        <AlertTitle>Не получилось</AlertTitle>
        <AlertDescription>{{ errorText }}</AlertDescription>
      </Alert>
      <p v-if="notice" class="text-xs text-emerald-300">{{ notice }}</p>
      <p v-if="missing.length > 0 && form !== null" class="text-xs text-amber-300">
        Не заполнено: {{ missing.join(", ") }}.
      </p>

      <!-- actions -->
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="existing === null" :disabled="busy !== null || accountId === ''" @click="prepare">
          <LoaderCircle v-if="busy === 'prepare'" class="size-4 animate-spin" />
          Загрузить форму
        </Button>
        <template v-else-if="form !== null">
          <Button variant="outline" :disabled="busy !== null" @click="saveDraft">
            <LoaderCircle v-if="busy === 'save'" class="size-4 animate-spin" />
            Сохранить черновик
          </Button>
          <Button v-if="!confirming" :disabled="busy !== null || missing.length > 0" @click="confirming = true">
            <Send class="size-4" />
            Отправить отклик
          </Button>
          <template v-else>
            <span class="text-xs text-muted-foreground">Отправится на hh.ru, отменить нельзя.</span>
            <Button variant="destructive" :disabled="busy !== null" @click="send">
              <LoaderCircle v-if="busy === 'send'" class="size-4 animate-spin" />
              Да, отправить
            </Button>
            <Button variant="ghost" :disabled="busy !== null" @click="confirming = false">Отмена</Button>
          </template>
        </template>
        <a
          v-if="existing"
          :href="`/applications/${existing.id}`"
          class="ml-auto text-xs text-muted-foreground hover:text-primary"
        >
          Подробности отклика
        </a>
      </div>
    </template>
  </section>
</template>
