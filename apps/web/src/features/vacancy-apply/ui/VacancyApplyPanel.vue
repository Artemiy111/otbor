<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { CircleAlert, CircleCheck, LoaderCircle, Send, Undo2 } from "@lucide/vue"
import type { GeneratedDraft } from "@otbor/domain"
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
import DraftGenerator from "./DraftGenerator.vue"
import LetterAttachBlock from "./LetterAttachBlock.vue"
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

/* ---- the vacancy form: the same for every applicant ---------------------- */

const errorText = ref<string | null>(null)
const notice = ref<string | null>(null)

const formQuery = useQuery({
  key: () => applicationKeys.vacancyForm(props.vacancyId),
  query: () => applicationApi.formGet(props.vacancyId)
})
const formState = computed(() => formQuery.data.value ?? null)
const form = computed(() => formState.value?.form ?? detail.value?.form?.form ?? null)
/** Hints are computed for an application's resume, so they exist once a draft does. */
const hints = computed<ReadonlyArray<StoredHint>>(() =>
  detail.value?.form?.form.formHash === form.value?.formHash ? (detail.value?.form?.hints ?? []) : []
)
const questions = computed<ReadonlyArray<FormQuestion>>(() => form.value?.questions ?? [])

const refreshing = ref(false)
const waitingForForm = computed(() => formState.value?.reading === true || refreshing.value)
const poller = useIntervalFn(
  () => {
    void formQuery.refetch()
  },
  3000,
  { immediate: false }
)
watch(
  waitingForForm,
  (waiting) => (waiting ? poller.resume() : poller.pause()),
  { immediate: true }
)

/** A stale form is read once per page visit; a vacancy hh says has no test waits until sending. */
const autoTried = ref(false)
const refreshForm = async (force: boolean) => {
  if (accountId.value === "") return
  refreshing.value = true
  try {
    await applicationApi.formRefresh({ vacancyId: props.vacancyId, hhAccountId: accountId.value, force })
    await formQuery.refetch()
  } finally {
    refreshing.value = false
  }
}
watch(
  [formState, accountId],
  () => {
    const current = formState.value
    if (current === null || autoTried.value || accountId.value === "") return
    if (!current.stale || current.reading) return
    if (props.data.facts?.hh?.test.hasTest === false) return
    autoTried.value = true
    void refreshForm(false).catch((error) => (errorText.value = describeError(error)))
  },
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

const hintFor = (questionId: string) => hints.value.find((hint) => hint.questionId === questionId)

/** A saved kit written for a form that has since changed. */
const kitIsOld = computed(() => {
  const kit = detail.value?.kit ?? null
  return kit !== null && form.value !== null && kit.formHash !== form.value.formHash
})

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

/** Answers exactly as the model wrote them; any edit by the operator makes them "human". */
const modelAnswers = new Map<string, AnswerState>()
const fromModel = (question: FormQuestion, answer: AnswerState): boolean => {
  const given = modelAnswers.get(question.id)
  if (given === undefined) return false
  return question.kind === "single" || question.kind === "multiple"
    ? sameSet(answer.optionIds, given.optionIds)
    : answer.text.trim() === given.text.trim()
}

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
      source: asHinted ? "hint" : fromModel(question, answer) ? "model" : "human",
      hard: asHinted ? hint.hard : false,
      needsHuman: false
    })
  }
  return out
}

/* ---- generated draft ------------------------------------------------------ */

interface Snapshot {
  letter: string
  answers: Record<string, AnswerState>
  signature: string
}
const snapshot = ref<Snapshot | null>(null)
const generatedInfo = ref<{
  model: string | null
  durationMs: number | null
  problems: ReadonlyArray<string>
} | null>(null)

const signatureNow = () => JSON.stringify([letter.value, answers])

const applyGenerated = (
  draft: GeneratedDraft,
  meta: { model: string | null; durationMs: number | null; accountId: string; resumeId: string }
) => {
  // The model may answer after the operator switched to another resume: the
  // text belongs to the resume it was written for, not to the one on screen.
  const target = `${meta.accountId}|${meta.resumeId}`
  if (target !== workspaceKey.value) {
    storeGeneratedElsewhere(target, draft)
    notice.value = "Письмо готово для другого резюме и сохранено в его черновик: переключитесь на него, чтобы увидеть."
    void persistElsewhere(meta.accountId, meta.resumeId, draft).catch((error) => {
      errorText.value = `Не удалось сохранить черновик для другого резюме: ${explain(error)}`
    })
    return
  }
  errorText.value = null
  notice.value = null
  const previous: Snapshot = {
    letter: letter.value,
    answers: JSON.parse(JSON.stringify(answers)) as Record<string, AnswerState>,
    signature: ""
  }
  if (draft.letter !== null && letterRule.value !== "absent") letter.value = draft.letter.slice(0, maxLetter)
  modelAnswers.clear()
  for (const item of draft.answers) {
    const question = questions.value.find((candidate) => candidate.id === item.questionId)
    if (question === undefined) continue
    const choice = question.kind === "single" || question.kind === "multiple"
    const next: AnswerState = choice
      ? { optionIds: [...(item.optionIds ?? [])], text: "" }
      : { optionIds: [], text: item.text ?? "" }
    answers[question.id] = next
    modelAnswers.set(question.id, { optionIds: [...next.optionIds], text: next.text })
  }
  generatedInfo.value = { model: meta.model, durationMs: meta.durationMs, problems: draft.problems }
  const changed = previous.letter.trim() !== "" || Object.values(previous.answers).some(
    (answer) => answer.optionIds.length > 0 || answer.text.trim() !== ""
  )
  void nextTick(() => {
    if (changed) snapshot.value = { ...previous, signature: signatureNow() }
  })
  notice.value = "Письмо и ответы подставлены и сохраняются как черновик. Проверьте их и отредактируйте."
  // A generation is something the operator asked for: keep its result instead of
  // leaving it on the screen only, so a reload or a switch cannot lose it.
  void nextTick(() => saveDraft().then(() => (notice.value = "Письмо и ответы подставлены и сохранены как черновик. Проверьте их и отредактируйте.")))
}

const undoGenerated = () => {
  const saved = snapshot.value
  if (saved === null) return
  letter.value = saved.letter
  for (const name of Object.keys(answers)) delete answers[name]
  Object.assign(answers, saved.answers)
  modelAnswers.clear()
  snapshot.value = null
  notice.value = "Подстановка отменена."
}

// The undo is offered only until the next edit or save.
watch([letter, answers], () => {
  if (snapshot.value !== null && snapshot.value.signature !== signatureNow()) snapshot.value = null
}, { deep: true, flush: "post" })

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

const busy = ref<"refresh" | "save" | "send" | null>(null)
const confirming = ref(false)

/* ---- one workspace per account + resume ---------------------------------- */

interface Workspace {
  letter: string
  answers: Record<string, AnswerState>
  model: Record<string, AnswerState>
  info: typeof generatedInfo.value
}

const workspaceKey = computed(() => `${accountId.value}|${resumeId.value}`)
/** What was typed or generated for the resumes the operator switched away from. */
const stash = new Map<string, Workspace>()
let hydratedKey: string | null = null

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const capture = (): Workspace => ({
  letter: letter.value,
  answers: clone(answers),
  model: Object.fromEntries(modelAnswers),
  info: generatedInfo.value
})

const clearFields = () => {
  letter.value = ""
  for (const name of Object.keys(answers)) delete answers[name]
  modelAnswers.clear()
  snapshot.value = null
  generatedInfo.value = null
  notice.value = null
  errorText.value = null
  confirming.value = false
}

const restore = (kept: Workspace) => {
  letter.value = kept.letter
  Object.assign(answers, clone(kept.answers))
  for (const [id, value] of Object.entries(kept.model)) modelAnswers.set(id, value)
  generatedInfo.value = kept.info
}

watch(
  workspaceKey,
  (next, previous) => {
    if (previous !== undefined) stash.set(previous, capture())
    clearFields()
    const kept = stash.get(next)
    if (kept !== undefined) {
      restore(kept)
      hydratedKey = next
    } else {
      hydratedKey = null
    }
  },
  { immediate: true }
)

const savedKit = computed(() => detail.value?.kit ?? null)

const savedAnswers = (): Map<string, Extract<KitAnswer, { questionId: string }>> =>
  new Map(
    (savedKit.value?.answers ?? [])
      .filter((item): item is Extract<KitAnswer, { questionId: string }> => "questionId" in item)
      .map((item) => [item.questionId, item])
  )

/** Letter and answers of the saved draft for this resume, then hints for what is still empty. */
watch(
  [detail, form, existing, workspaceKey],
  () => {
    const ready = existing.value === null || detail.value?.application.id === existing.value.id
    if (!ready) return
    if (hydratedKey !== workspaceKey.value) {
      hydratedKey = workspaceKey.value
      letter.value = savedKit.value?.letter ?? ""
      for (const name of Object.keys(answers)) delete answers[name]
    }
    const current = form.value
    if (current === null) return
    const saved = savedAnswers()
    for (const question of current.questions) {
      const own = answers[question.id]
      if (own !== undefined && (own.optionIds.length > 0 || own.text !== "")) continue
      const kitAnswer = saved.get(question.id)
      const hint = hints.value.find((item) => item.questionId === question.id)
      answers[question.id] = {
        optionIds: [...(kitAnswer?.optionIds ?? hint?.optionIds ?? [])],
        text: kitAnswer?.text ?? hint?.text ?? ""
      }
    }
  },
  { immediate: true }
)

/** A draft generated for a resume that is not on screen waits for it. */
const storeGeneratedElsewhere = (target: string, draft: GeneratedDraft) => {
  const base = stash.get(target) ?? { letter: "", answers: {}, model: {}, info: null }
  const next: Workspace = { ...clone(base), info: base.info }
  if (draft.letter !== null) next.letter = draft.letter.slice(0, maxLetter)
  for (const item of draft.answers) {
    const question = questions.value.find((candidate) => candidate.id === item.questionId)
    if (question === undefined) continue
    const choice = question.kind === "single" || question.kind === "multiple"
    const value: AnswerState = choice
      ? { optionIds: [...(item.optionIds ?? [])], text: "" }
      : { optionIds: [], text: item.text ?? "" }
    next.answers[question.id] = value
    next.model[question.id] = clone(value)
  }
  stash.set(target, next)
}

/** Saves a generation that finished for a resume other than the one on screen. */
const persistElsewhere = async (targetAccountId: string, targetResumeId: string, draft: GeneratedDraft) => {
  const { application } = await applicationApi.createManual({
    vacancyId: props.vacancyId,
    hhAccountId: targetAccountId,
    resumeId: targetResumeId || undefined
  })
  const answersToSave: Array<KitAnswer> = []
  for (const item of draft.answers) {
    const question = questions.value.find((candidate) => candidate.id === item.questionId)
    if (question === undefined) continue
    const choice = question.kind === "single" || question.kind === "multiple"
    answersToSave.push({
      questionId: question.id,
      ...(choice ? { optionIds: [...(item.optionIds ?? [])] } : { text: (item.text ?? "").trim() }),
      source: "model",
      hard: false,
      needsHuman: false
    })
  }
  await applicationApi.setKit({
    applicationId: application.id,
    formHash: form.value?.formHash ?? NO_FORM,
    letter: draft.letter === null ? null : draft.letter.slice(0, maxLetter).trim(),
    answers: answersToSave
  })
  emit("changed")
}

const normalize = (text: string, list: ReadonlyArray<KitAnswer>): string =>
  JSON.stringify([
    text.trim(),
    list
      .values()
      .filter((item): item is Extract<KitAnswer, { questionId: string }> => "questionId" in item)
      .map((item) => [item.questionId, [...(item.optionIds ?? [])].sort(), (item.text ?? "").trim()])
      .toArray()
      .sort()
  ])

/** The screen differs from the draft saved for this resume. */
const dirty = computed(
  () =>
    normalize(letter.value, buildAnswers()) !==
    normalize(savedKit.value?.letter ?? "", savedKit.value?.answers ?? [])
)

const revertToSaved = () => {
  letter.value = savedKit.value?.letter ?? ""
  for (const name of Object.keys(answers)) delete answers[name]
  modelAnswers.clear()
  snapshot.value = null
  hydratedKey = null
  // the hydration watcher fills answers from the saved kit again
  notice.value = "Возвращён сохранённый черновик."
  void nextTick(() => {
    hydratedKey = workspaceKey.value
    const saved = savedAnswers()
    for (const question of questions.value) {
      const kitAnswer = saved.get(question.id)
      answers[question.id] = {
        optionIds: [...(kitAnswer?.optionIds ?? [])],
        text: kitAnswer?.text ?? ""
      }
    }
  })
}

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads the form again and waits for the result. Throws if hh could not be read. */
const readFormNow = async () => {
  const before = formState.value?.checkedAt ?? null
  await applicationApi.formRefresh({ vacancyId: props.vacancyId, hhAccountId: accountId.value, force: true })
  for (let attempt = 0; attempt < 40; attempt++) {
    await pause(3000)
    await formQuery.refetch()
    const current = formState.value
    if (current !== null && !current.reading) {
      if (current.checkedAt !== null && current.checkedAt !== before) return
      throw new Error(current.lastError ?? "Не удалось прочитать форму отклика на hh.")
    }
  }
  throw new Error("hh слишком долго не отвечает: форма не обновилась.")
}

const refreshClick = async () => {
  if (busy.value !== null || accountId.value === "") return
  busy.value = "refresh"
  errorText.value = null
  notice.value = null
  try {
    await readFormNow()
  } catch (error) {
    errorText.value = explain(error)
  } finally {
    busy.value = null
  }
}

/** The draft is created only here, when there is something to keep. */
const ensureApplication = async (): Promise<string> => {
  if (existing.value !== null) return existing.value.id
  const { application } = await applicationApi.createManual({
    vacancyId: props.vacancyId,
    hhAccountId: accountId.value,
    resumeId: resumeId.value || undefined
  })
  emit("changed")
  return application.id
}

const saveKit = async (applicationId: string) => {
  // A letter-only draft is kept even before any form was read; the form is
  // read again and the kit is saved against its real hash before sending.
  await applicationApi.setKit({
    applicationId,
    formHash: form.value?.formHash ?? NO_FORM,
    letter: letter.value.trim() === "" ? null : letter.value.trim(),
    answers: buildAnswers()
  })
}

const saveDraft = async () => {
  if (busy.value !== null || accountId.value === "") return
  busy.value = "save"
  errorText.value = null
  notice.value = null
  try {
    const id = await ensureApplication()
    await saveKit(id)
    await detailQuery.refetch()
    snapshot.value = null
    notice.value = "Черновик сохранён."
  } catch (error) {
    errorText.value = explain(error)
  } finally {
    busy.value = null
  }
}

const send = async () => {
  if (busy.value !== null || accountId.value === "") return
  busy.value = "send"
  errorText.value = null
  notice.value = null
  try {
    // Right before an irreversible send the form is read again: the employer
    // may have changed the questions since the page was opened.
    const seen = form.value?.formHash ?? null
    await readFormNow()
    if (seen !== null && form.value?.formHash !== seen) {
      notice.value = null
      throw new Error("Форма на hh изменилась: проверьте вопросы и отправьте ещё раз.")
    }
    const id = await ensureApplication()
    await saveKit(id)
    await applicationApi.approve(id)
    confirming.value = false
    await detailQuery.refetch()
    emit("changed")
    snapshot.value = null
    notice.value = "Отклик поставлен в очередь на отправку."
  } catch (error) {
    errorText.value = explain(error)
    confirming.value = false
  } finally {
    busy.value = null
  }
}

const maxLetter = 10_000
const NO_FORM = "no-form"
</script>

<template>
  <section class="space-y-4 rounded-lg border border-border bg-card p-4 text-sm">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-base font-semibold">Отклик</h2>
      <StatusBadge v-if="state && !finished" :value="state" />
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

    <LetterAttachBlock
      v-if="finished || sent.some((item) => item.accountId === accountId)"
      :vacancy-id="vacancyId"
      :account-id="accountId"
      :resume-id="resumeId"
      :applications="applications"
    />

    <template v-else>
      <!-- the vacancy form: read once, shared by every applicant -->
      <div v-if="waitingForForm" class="flex items-center gap-2 rounded-md border border-border p-3 text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />
        Читаю форму отклика на hh…
      </div>
      <template v-else-if="form === null && data.facts?.hh?.test.hasTest === false" />
      <div
        v-else-if="form === null"
        class="rounded-md border border-dashed border-border p-3 text-muted-foreground"
      >
        Про тест у этой вакансии пока ничего не известно, форму ещё не читали.
        <Button variant="ghost" size="sm" :disabled="busy !== null || accountId === ''" @click="refreshClick">
          Прочитать форму
        </Button>
      </div>
      <div v-else class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Форма с hh, прочитана {{ formatDate(formState?.checkedAt) }}<template
            v-if="(formState?.versions ?? 0) > 1"
          >; вопросы менялись {{ formatDate(formState?.changedAt) }}</template>.
        </span>
        <Button variant="ghost" size="sm" :disabled="busy !== null || accountId === ''" @click="refreshClick">
          <LoaderCircle v-if="busy === 'refresh'" class="size-4 animate-spin" />
          Обновить форму
        </Button>
      </div>
      <Alert v-if="formState?.lastError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Форму не удалось обновить</AlertTitle>
        <AlertDescription>{{ formState.lastError }}</AlertDescription>
      </Alert>
      <p v-if="kitIsOld" class="text-xs text-amber-700 dark:text-amber-300">
        Вопросы на hh изменились после сохранения черновика. Проверьте ответы перед отправкой.
      </p>
      <Alert v-if="state === 'needs_human' || state === 'failed'" variant="destructive">
        <CircleAlert />
        <AlertTitle>{{ statusLabel(state) }}</AlertTitle>
        <AlertDescription>Проверьте ответы и отправьте ещё раз, либо откройте отклик, чтобы увидеть попытки.</AlertDescription>
      </Alert>

      <!-- generator: one model call for the letter and the test answers -->
      <div class="space-y-2 rounded-md border border-border p-3">
        <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Составить с помощью модели
        </span>
        <DraftGenerator
          :vacancy-id="vacancyId"
          :account-id="accountId"
          :resume-id="resumeId"
          :questions="questions"
          :disabled="busy !== null"
          @generated="applyGenerated"
          @failed="(reason) => (errorText = reason)"
        />
        <div v-if="generatedInfo" class="space-y-1 text-xs text-muted-foreground">
          <p>
            Составила: {{ generatedInfo.model ?? "модель не указана" }}<template
              v-if="generatedInfo.durationMs !== null"
            >, {{ (generatedInfo.durationMs / 1000).toFixed(1) }} с</template>. Ничего не сохранено и не отправлено.
          </p>
          <ul v-if="generatedInfo.problems.length > 0" class="list-disc space-y-0.5 pl-5 text-amber-700 dark:text-amber-300">
            <li v-for="problem in generatedInfo.problems" :key="problem">{{ problem }}</li>
          </ul>
        </div>
        <Button v-if="snapshot" variant="ghost" size="sm" @click="undoGenerated">
          <Undo2 class="size-4" />
          Отменить подстановку
        </Button>
      </div>

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
            <template v-else>формат уточнится после чтения формы</template>
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
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span v-if="savedKit">
            Черновик для этого резюме сохранён {{ formatDate(savedKit.createdAt) }}.
          </span>
          <span v-else>Для этого резюме черновика нет.</span>
          <span v-if="dirty" class="text-amber-700 dark:text-amber-300">Есть несохранённые изменения.</span>
          <Button v-if="dirty && savedKit" variant="ghost" size="sm" :disabled="busy !== null" @click="revertToSaved">
            Вернуть сохранённое
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Черновик хранит письмо и ответы теста для пары «аккаунт + резюме». На hh ничего не отправляется.
        </p>
      </div>

      <!-- test -->
      <div v-if="form !== null && questions.length > 0" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Тест работодателя ({{ questions.length }})
          </span>
          <span v-if="needsOwnAnswer > 0" class="text-xs text-amber-700 dark:text-amber-300">
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
            <span v-if="question.required" class="text-red-700 dark:text-red-300">*</span>
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
      <p v-if="notice" class="text-xs text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <p v-if="missing.length > 0" class="text-xs text-amber-700 dark:text-amber-300">
        Не заполнено: {{ missing.join(", ") }}.
      </p>

      <!-- actions -->
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" :disabled="busy !== null || accountId === ''" @click="saveDraft">
          <LoaderCircle v-if="busy === 'save'" class="size-4 animate-spin" />
          Сохранить черновик
        </Button>
        <Button
          v-if="!confirming"
          :disabled="busy !== null || accountId === '' || missing.length > 0"
          @click="confirming = true"
        >
          <Send class="size-4" />
          Отправить отклик
        </Button>
        <template v-else>
          <span class="text-xs text-muted-foreground">Форма прочитается заново, отклик уйдёт на hh.ru, отменить нельзя.</span>
          <Button variant="destructive" :disabled="busy !== null" @click="send">
            <LoaderCircle v-if="busy === 'send'" class="size-4 animate-spin" />
            Да, отправить
          </Button>
          <Button variant="ghost" :disabled="busy !== null" @click="confirming = false">Отмена</Button>
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
