<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { FileText, LoaderCircle, Sparkles } from "@lucide/vue"
import type { FormQuestion, HarnessJob } from "@otbor/contract"
import { parseGeneratedDraft, type GeneratedDraft } from "@otbor/domain"
import { applicationApi, applicationKeys } from "@/entities/application"
import { describeError } from "@/shared/lib"
import {
  Button,
  HarnessModelPicker,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  resolveHarnessEffort,
  type HarnessEntry,
  type HarnessModel
} from "@/shared/ui"

const props = defineProps<{
  vacancyId: string
  accountId: string
  resumeId: string
  questions: ReadonlyArray<FormQuestion>
  disabled?: boolean
}>()

const emit = defineEmits<{
  generated: [
    draft: GeneratedDraft,
    meta: { model: string | null; durationMs: number | null; accountId: string; resumeId: string }
  ]
  failed: [reason: string]
}>()

const STORAGE_KEY = "otbor.draft-generator.choice"
const POLL_MS = 2000
const GIVE_UP_MS = 5 * 60 * 1000

/* ---- catalog ------------------------------------------------------------- */

const catalogQuery = useQuery({
  key: () => applicationKeys.agentCatalog,
  query: () => applicationApi.agentCatalog(),
  staleTime: 30_000
})
const catalog = computed(() => catalogQuery.data.value ?? null)

const harnesses = computed<HarnessEntry[]>(() =>
  (catalog.value?.harnesses ?? []).map((harness) => ({
    id: harness.id,
    name: harness.name,
    error: harness.available ? null : (harness.error ?? "недоступен")
  }))
)
const models = computed<HarnessModel[]>(() =>
  (catalog.value?.harnesses ?? []).flatMap((harness) =>
    harness.models.map((model) => ({
      id: model.id,
      harness: harness.id,
      label: model.label,
      efforts: [...model.efforts],
      ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
      ...(model.variant ? { variant: model.variant } : {})
    }))
  )
)
const catalogEmpty = computed(
  () => catalog.value !== null && !models.value.some((item) => harnessOk(item.harness))
)
const harnessOk = (id: string) =>
  catalog.value?.harnesses.find((harness) => harness.id === id)?.available === true

const catalogError = computed(() => {
  if (catalogQuery.error.value) return `Каталог моделей недоступен: ${describeError(catalogQuery.error.value)}`
  return null
})

/* ---- the operator's last choice ------------------------------------------ */

const provider = ref("")
const model = ref("")
const effort = ref("")

const readSaved = (): { provider: string; model: string; effort: string } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.provider !== "string" || typeof value.model !== "string") return null
    return { provider: value.provider, model: value.model, effort: typeof value.effort === "string" ? value.effort : "" }
  } catch {
    return null
  }
}
const writeSaved = () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ provider: provider.value, model: model.value, effort: effort.value })
    )
  } catch {
    // private mode or blocked storage: the choice just is not remembered
  }
}

const find = (harness: string, id: string) =>
  models.value.find((item) => item.harness === harness && item.id === id) ?? null

/** Saved choice if it is still in the catalog, else the first available harness default. */
const settle = () => {
  if (catalog.value === null) return
  if (find(provider.value, model.value) !== null && harnessOk(provider.value)) return
  const saved = readSaved()
  if (saved !== null && harnessOk(saved.provider)) {
    const known = find(saved.provider, saved.model)
    if (known !== null) {
      provider.value = saved.provider
      model.value = saved.model
      effort.value = resolveHarnessEffort(known, saved.effort)
      return
    }
  }
  // Nothing saved yet: Claude Code on Haiku 5.5 with low effort is cheap and fast.
  const haiku = find("claude", "haiku")
  if (haiku !== null && harnessOk("claude")) {
    provider.value = "claude"
    model.value = haiku.id
    effort.value = resolveHarnessEffort(haiku, "low")
    return
  }
  const harness = catalog.value.harnesses.find((item) => item.available && item.models.length > 0)
  if (harness === undefined) {
    provider.value = catalog.value.harnesses[0]?.id ?? ""
    model.value = ""
    effort.value = ""
    return
  }
  const picked = find(harness.id, harness.defaultModel ?? "") ?? find(harness.id, harness.models[0]!.id)
  provider.value = harness.id
  model.value = picked?.id ?? ""
  effort.value = resolveHarnessEffort(picked, "")
}
watch(catalog, settle, { immediate: true })

/** A harness tab was clicked: move to its default model. */
watch(provider, (next, previous) => {
  if (next === previous || catalog.value === null) return
  if (find(next, model.value) !== null) return
  const harness = catalog.value.harnesses.find((item) => item.id === next)
  if (harness === undefined || !harness.available) {
    model.value = ""
    effort.value = ""
    return
  }
  const picked = find(next, harness.defaultModel ?? "") ?? find(next, harness.models[0]?.id ?? "")
  model.value = picked?.id ?? ""
  effort.value = resolveHarnessEffort(picked, effort.value)
})
watch([provider, model, effort], () => {
  if (model.value !== "") writeSaved()
})

/* ---- the prompt that would be sent (read-only) --------------------------- */

const promptOpen = ref(false)
const promptText = ref<{ system: string; user: string; promptVersion: string } | null>(null)
const promptError = ref<string | null>(null)
const promptLoading = ref(false)
const showPrompt = async () => {
  promptOpen.value = true
  promptLoading.value = true
  promptError.value = null
  promptText.value = null
  try {
    promptText.value = await applicationApi.draftPrompt({
      vacancyId: props.vacancyId,
      hhAccountId: props.accountId,
      resumeId: props.resumeId || undefined
    })
  } catch (error) {
    promptError.value = describeError(error)
  } finally {
    promptLoading.value = false
  }
}

/* ---- running ------------------------------------------------------------- */

const running = ref(false)
const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let cancelled = false

const stopTimer = () => {
  if (timer !== null) clearInterval(timer)
  timer = null
}
onBeforeUnmount(() => {
  cancelled = true
  stopTimer()
})

const canRun = computed(
  () => !props.disabled && !running.value && props.accountId !== "" && model.value !== "" && harnessOk(provider.value)
)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const FAILED = new Set(["failed", "dead", "needs_human", "cancelled"])
const STATUS_TEXT: Record<string, string> = {
  failed: "задача завершилась ошибкой",
  dead: "задача исчерпала попытки",
  needs_human: "модель попросила вмешательство человека",
  cancelled: "задача отменена"
}

const reasonOf = (job: HarnessJob): string => {
  const base = STATUS_TEXT[job.status] ?? `статус ${job.status}`
  const result = job.result as { error?: unknown; message?: unknown } | null | undefined
  const detail = [result?.error, result?.message].find((item) => typeof item === "string")
  return typeof detail === "string" ? `${base}: ${detail}` : base
}

const run = async () => {
  if (!canRun.value) return
  running.value = true
  cancelled = false
  elapsed.value = 0
  const startedAt = Date.now()
  const startedFor = { accountId: props.accountId, resumeId: props.resumeId }
  timer = setInterval(() => (elapsed.value = Math.round((Date.now() - startedAt) / 1000)), 500)
  try {
    const { job: queued } = await applicationApi.draftGenerate({
      vacancyId: props.vacancyId,
      hhAccountId: props.accountId,
      resumeId: props.resumeId || undefined,
      harness: provider.value,
      model: model.value,
      effort: effort.value || undefined
    })
    let job: HarnessJob = queued
    while (job.status !== "done" && !FAILED.has(job.status)) {
      if (Date.now() - startedAt > GIVE_UP_MS) {
        throw new Error("Модель не ответила за 5 минут. Задача могла остаться в очереди: проверьте, что запущен `otbor harness run`.")
      }
      await sleep(POLL_MS)
      if (cancelled) return
      job = await applicationApi.inferenceGet(job.id)
    }
    if (job.status !== "done") throw new Error(`Не удалось сгенерировать: ${reasonOf(job)}.`)
    const result = job.result as { text?: unknown; model?: unknown; durationMs?: unknown } | null | undefined
    if (typeof result?.text !== "string" || result.text.trim() === "") {
      throw new Error("Модель вернула пустой ответ.")
    }
    const draft = parseGeneratedDraft(result.text, props.questions)
    if (draft.letter === null && draft.answers.length === 0) {
      throw new Error(
        `Ответ модели не разобрать${draft.problems.length > 0 ? `: ${draft.problems.join("; ")}` : ""}.`
      )
    }
    emit("generated", draft, {
      model: typeof result.model === "string" ? result.model : null,
      durationMs: typeof result.durationMs === "number" ? result.durationMs : Date.now() - startedAt,
      // the resume it was started for, even if the operator switched meanwhile
      accountId: startedFor.accountId,
      resumeId: startedFor.resumeId
    })
  } catch (error) {
    if (!cancelled) emit("failed", describeError(error))
  } finally {
    stopTimer()
    running.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <HarnessModelPicker
        v-model:provider="provider"
        v-model:model="model"
        v-model:effort="effort"
        :harnesses="harnesses"
        :models="models"
        :loading="catalogQuery.isLoading.value"
        :error="catalogError"
        :disabled="running || disabled"
        class="border-border"
        @refresh="catalogQuery.refetch()"
      />
      <Button size="sm" :disabled="!canRun" @click="run">
        <LoaderCircle v-if="running" class="size-4 animate-spin" />
        <Sparkles v-else class="size-4" />
        Сгенерировать письмо и ответы
      </Button>
      <Button variant="ghost" size="sm" :disabled="accountId === ''" @click="showPrompt">
        <FileText class="size-4" />
        Промпт
      </Button>
      <span v-if="running" class="text-xs text-muted-foreground">Модель думает, {{ elapsed }} с…</span>
    </div>

    <Sheet v-model:open="promptOpen">
      <SheetContent side="right" class="w-full overflow-y-auto p-4 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Промпт для модели</SheetTitle>
          <SheetDescription>
            Только просмотр: это ровно то, что уйдёт в модель при генерации
            <template v-if="promptText">(версия {{ promptText.promptVersion }})</template>.
          </SheetDescription>
        </SheetHeader>
        <p v-if="promptLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle class="size-4 animate-spin" /> Собираю промпт…
        </p>
        <p v-else-if="promptError" class="text-sm text-amber-700 dark:text-amber-300">{{ promptError }}</p>
        <template v-else-if="promptText">
          <section class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Системный промпт</h3>
            <pre class="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">{{ promptText.system }}</pre>
          </section>
          <section class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Данные запроса (вакансия, резюме, вопросы)
            </h3>
            <pre class="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">{{ promptText.user }}</pre>
          </section>
        </template>
      </SheetContent>
    </Sheet>
    <p v-if="catalogQuery.isLoading.value" class="text-xs text-muted-foreground">Загружаю список моделей…</p>
    <p v-else-if="catalogError" class="text-xs text-amber-700 dark:text-amber-300">{{ catalogError }}</p>
    <p v-else-if="catalog !== null && (catalog.harnesses.length === 0 || catalogEmpty)" class="text-xs text-amber-700 dark:text-amber-300">
      Ни один харнес пока не сообщил свои модели. Запустите `otbor harness run`.
    </p>
    <p v-else-if="accountId === ''" class="text-xs text-muted-foreground">Выберите аккаунт, чтобы сгенерировать.</p>
  </div>
</template>
