<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { CircleAlert } from "@lucide/vue"
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
import { HumanStatusBadge, humanStatus } from "@/entities/auto-apply"
import { applicationPath, describeError, statusLabel } from "@/shared/lib"
import {
  buildKitAnswers,
  isChoice,
  kitProblems,
  kitSignature,
  missingParts,
  problemText,
  problemsByQuestion,
  savedAnswerMap,
  type AnswerState,
  type KitProblem
} from "../lib/answers"
import AccountResumePicker from "./AccountResumePicker.vue"
import ApplyEmpty from "./apply/ApplyEmpty.vue"
import ApplyFooter from "./apply/ApplyFooter.vue"
import ApplyFormStep from "./apply/ApplyFormStep.vue"
import ApplyLetterStep from "./apply/ApplyLetterStep.vue"
import ApplyPreparing from "./apply/ApplyPreparing.vue"
import ApplyStep from "./apply/ApplyStep.vue"
import LetterAttachBlock from "./LetterAttachBlock.vue"
import { Alert, AlertDescription, AlertTitle, Badge, useToast } from "@/shared/ui"

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

const toast = useToast()

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
    void refreshForm(false).catch((error) =>
      toast.error("Не удалось обновить форму", { description: describeError(error) })
    )
  },
  { immediate: true }
)

const finished = computed(() =>
  ["submitted", "submitting", "queued"].includes(state.value ?? "")
)

/**
 * Автоотклик готовит раннер (форма, письмо, кит): редактор заперт, иначе
 * «Сохранить» и «Отправить» гонялись бы с ним. Пропустить можно.
 */
const preparing = computed(() => state.value === "preparing")

const skipPreparing = async () => {
  const id = existing.value?.id
  if (busy.value !== null || id === undefined) return
  busy.value = "save"
  try {
    await applicationApi.skip(id, "skipped from the vacancy page")
    await detailQuery.refetch()
    emit("changed")
    toast.success("Отклик пропущен")
  } catch (error) {
    toast.error("Не удалось пропустить отклик", { description: explain(error) })
  } finally {
    busy.value = null
  }
}

/* ---- letter and answers -------------------------------------------------- */

const letter = ref("")
const answers = reactive<Record<string, AnswerState>>({})

/** A saved kit written for a form that has since changed. */
const kitIsOld = computed(() => {
  const kit = detail.value?.kit ?? null
  return kit !== null && form.value !== null && kit.formHash !== form.value.formHash
})

/** Ответы ровно так, как их написала модель; любая правка оператора делает их «human». */
const modelAnswers = new Map<string, AnswerState>()

const buildAnswers = (): Array<KitAnswer> =>
  buildKitAnswers({ questions: questions.value, answers, hints: hints.value, model: modelAnswers })

/** Отказ сервера по вопросам: показывается у вопроса, пока его не поправят. */
const problems = ref<ReadonlyArray<KitProblem>>([])
const problemMap = computed(() => problemsByQuestion(problems.value))
const changeAnswer = (questionId: string, value: AnswerState) => {
  answers[questionId] = value
  if (problems.value.some((problem) => problem.questionId === questionId)) {
    problems.value = problems.value.filter((problem) => problem.questionId !== questionId)
  }
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
    toast.info("Письмо готово для другого резюме", {
      description: "Оно сохранено в его черновик: переключитесь на это резюме, чтобы увидеть."
    })
    void persistElsewhere(meta.accountId, meta.resumeId, draft).catch((error) => {
      toast.error("Не удалось сохранить черновик для другого резюме", { description: explain(error) })
    })
    return
  }
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
    const choice = isChoice(question)
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
  // A generation is something the operator asked for: keep its result instead of
  // leaving it on the screen only, so a reload or a switch cannot lose it.
  void nextTick(() =>
    saveDraft(true).then((saved) => {
      if (saved) {
        toast.success("Письмо и ответы подставлены", {
          description: "Сохранено как черновик. Проверьте и отредактируйте."
        })
      }
    })
  )
}

const undoGenerated = () => {
  const saved = snapshot.value
  if (saved === null) return
  letter.value = saved.letter
  for (const name of Object.keys(answers)) delete answers[name]
  Object.assign(answers, saved.answers)
  modelAnswers.clear()
  snapshot.value = null
  toast.info("Подстановка отменена")
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

const missing = computed(() =>
  missingParts({ letter: letter.value, letterRule: letterRule.value, questions: questions.value, answers })
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
  confirming.value = false
  problems.value = []
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

const savedAnswers = () => savedAnswerMap(savedKit.value?.answers)

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
    const choice = isChoice(question)
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
    const choice = isChoice(question)
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

/** The screen differs from the draft saved for this resume. */
const dirty = computed(
  () =>
    kitSignature(letter.value, buildAnswers()) !==
    kitSignature(savedKit.value?.letter, savedKit.value?.answers ?? [])
)

const revertToSaved = () => {
  letter.value = savedKit.value?.letter ?? ""
  for (const name of Object.keys(answers)) delete answers[name]
  modelAnswers.clear()
  snapshot.value = null
  hydratedKey = null
  // the hydration watcher fills answers from the saved kit again
  toast.info("Возвращён сохранённый черновик")
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
  const failed = kitProblems(error)
  problems.value = failed
  if (failed.length > 0) return [...new Set(failed.map(problemText))].join(" ")
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
  try {
    await readFormNow()
    toast.success("Форма отклика обновлена")
  } catch (error) {
    toast.error("Не удалось обновить форму", { description: explain(error) })
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

/** Сохраняет черновик; `quiet` - без своего уведомления (его покажет вызывающий). Возвращает, получилось ли. */
const saveDraft = async (quiet = false): Promise<boolean> => {
  if (busy.value !== null || accountId.value === "") return false
  busy.value = "save"
  problems.value = []
  try {
    const id = await ensureApplication()
    await saveKit(id)
    await detailQuery.refetch()
    snapshot.value = null
    if (!quiet) toast.success("Черновик сохранён")
    return true
  } catch (error) {
    toast.error("Не удалось сохранить черновик", { description: explain(error) })
    return false
  } finally {
    busy.value = null
  }
}

const send = async () => {
  if (busy.value !== null || accountId.value === "") return
  busy.value = "send"
  problems.value = []
  try {
    // Right before an irreversible send the form is read again: the employer
    // may have changed the questions since the page was opened.
    const seen = form.value?.formHash ?? null
    await readFormNow()
    if (seen !== null && form.value?.formHash !== seen) {
      throw new Error("Форма на hh изменилась: проверьте вопросы и отправьте ещё раз.")
    }
    const id = await ensureApplication()
    await saveKit(id)
    await applicationApi.approve(id)
    confirming.value = false
    await detailQuery.refetch()
    emit("changed")
    snapshot.value = null
    toast.success("Отклик поставлен в очередь на отправку")
  } catch (error) {
    toast.error("Не удалось отправить отклик", { description: explain(error) })
    confirming.value = false
  } finally {
    busy.value = null
  }
}

const maxLetter = 10_000
const NO_FORM = "no-form"

/* ---- что показать в шапке и подвале -------------------------------------- */

/** Состояние найденного отклика на общем словаре; `null`, пока откликов с этим резюме нет. */
const humanState = computed(() => (existing.value === null ? null : humanStatus(existing.value)))
/** С этого аккаунта уже откликались (этим или другим резюме): форма скрыта. */
const alreadyApplied = computed(() => finished.value || sent.value.some((item) => item.accountId === accountId.value))
const accountResumes = computed(() => props.resumes.filter((resume) => resume.hhAccountId === accountId.value))
const emptyReason = computed<"no-accounts" | "no-resumes" | null>(() =>
  props.accounts.length === 0 ? "no-accounts" : accountResumes.value.length === 0 ? "no-resumes" : null
)
const editable = computed(() => emptyReason.value === null && !alreadyApplied.value && !preparing.value)
const hasForm = computed(() => form.value !== null)
const dismissGenerated = (reason: string) => toast.error("Не удалось написать письмо", { description: reason })
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-card text-sm" aria-labelledby="apply-title">
    <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h2 id="apply-title" class="text-base font-semibold">Отклик</h2>
      <HumanStatusBadge v-if="humanState && !finished" :status="humanState" :show-detail="false" />
    </header>

    <div class="min-h-0 flex-1 space-y-5 px-4 py-4 xl:overflow-y-auto">
      <ApplyStep :n="1" title="Кем откликаемся" id="apply-who">
        <ApplyEmpty v-if="emptyReason === 'no-accounts'" reason="no-accounts" />
        <template v-else>
          <AccountResumePicker
            v-model:account-id="accountId"
            v-model:resume-id="resumeId"
            :accounts="accounts"
            :resumes="resumes"
            :sent="sent"
            :disabled="busy !== null"
          />
          <p v-if="sent.length > 0" class="text-xs text-muted-foreground">
            Резюме, с которыми вы уже откликались, помечены в списке.
          </p>
          <ApplyEmpty v-if="emptyReason === 'no-resumes'" reason="no-resumes" />
          <div v-if="data.facts?.hh?.test.hasTest || data.facts?.hh?.letterRequired" class="flex flex-wrap gap-1.5">
            <Badge v-if="data.facts?.hh?.letterRequired" variant="warning">hh требует письмо</Badge>
            <Badge v-if="data.facts?.hh?.test.hasTest" variant="warning">
              {{ data.facts.hh.test.required === false ? "тест необязательный" : "есть тест" }}
            </Badge>
          </div>
        </template>
      </ApplyStep>

      <template v-if="emptyReason === null">
        <!-- уже откликались: статус и письмо, форма не нужна -->
        <section v-if="alreadyApplied" class="space-y-3" aria-label="Отклик уже отправлен">
          <div class="flex flex-wrap items-center gap-2">
            <HumanStatusBadge v-if="humanState" :status="humanState" :show-detail="false" />
            <span class="text-muted-foreground">Вы уже откликнулись с этого аккаунта, форма закрыта.</span>
            <a
              v-if="existing"
              :href="applicationPath(existing.id)"
              class="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >Подробности отклика</a>
          </div>
          <LetterAttachBlock
            :vacancy-id="vacancyId"
            :account-id="accountId"
            :resume-id="resumeId"
            :applications="applications"
            :sent-letter="state === 'submitted' ? (savedKit?.letter ?? null) : null"
            :sending="state === 'submitting' || state === 'queued'"
          />
        </section>

        <ApplyPreparing v-else-if="preparing" :busy="busy !== null" @skip="skipPreparing" />

        <template v-else>
          <Alert v-if="state === 'needs_human' || state === 'failed'" variant="destructive">
            <CircleAlert />
            <AlertTitle>{{ statusLabel(state) }}</AlertTitle>
            <AlertDescription>Проверьте ответы и отправьте ещё раз, либо откройте отклик, чтобы увидеть попытки.</AlertDescription>
          </Alert>

          <ApplyFormStep
            :n="2"
            :form-state="formState"
            :has-test="data.facts?.hh?.test.hasTest"
            :waiting="waitingForForm"
            :refreshing="busy === 'refresh' || refreshing"
            :busy="busy !== null"
            :disabled-refresh="accountId === ''"
            :questions="questions"
            :answers="answers"
            :hints="hints"
            :problems="problemMap"
            :kit-is-old="kitIsOld"
            :has-form="hasForm"
            @refresh="refreshClick"
            @change="changeAnswer"
          />

          <ApplyLetterStep
            v-model="letter"
            :n="3"
            :vacancy-id="vacancyId"
            :account-id="accountId"
            :resume-id="resumeId"
            :questions="questions"
            :busy="busy !== null"
            :letter-rule="letterRule"
            :max-letter="maxLetter"
            :generated-info="generatedInfo"
            :can-undo="snapshot !== null"
            @generated="applyGenerated"
            @failed="dismissGenerated"
            @undo="undoGenerated"
          />
        </template>
      </template>
    </div>

    <ApplyFooter
      v-if="editable"
      v-model:confirming="confirming"
      :busy="busy"
      :can-act="accountId !== ''"
      :dirty="dirty"
      :saved-at="savedKit?.createdAt ?? null"
      :has-saved="savedKit !== null"
      :missing="missing"
      :application-id="existing?.id ?? null"
      class="sticky bottom-0 z-10"
      @save="saveDraft()"
      @send="send"
      @revert="revertToSaved"
    />
  </section>
</template>
