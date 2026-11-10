<script setup lang="ts">
import { computed } from "vue"
import { CircleAlert, LoaderCircle, RefreshCw } from "@lucide/vue"
import type { FormQuestion, StoredHint, VacancyFormState } from "@otbor/contract"
import { cn, formatDate, toneClasses } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"
import { formStatus } from "../../lib/formState"
import type { AnswerState } from "../../lib/answers"
import AnswersEditor from "../AnswersEditor.vue"
import ApplyStep from "./ApplyStep.vue"

/** Шаг «Анкета работодателя»: состояние формы словами и ответы на вопросы. */
const props = defineProps<{
  n: number
  formState: VacancyFormState | null
  hasTest: boolean | null | undefined
  /** Идёт чтение анкеты (своё или раннера). */
  waiting: boolean
  refreshing: boolean
  busy: boolean
  disabledRefresh: boolean
  questions: ReadonlyArray<FormQuestion>
  answers: Readonly<Record<string, AnswerState>>
  hints: ReadonlyArray<StoredHint>
  problems: ReadonlyMap<string, ReadonlyArray<string>>
  kitIsOld: boolean
  hasForm: boolean
}>()
const emit = defineEmits<{ refresh: []; change: [questionId: string, answer: AnswerState] }>()

const status = computed(() =>
  formStatus({
    form: props.formState?.form ?? (props.hasForm ? { questions: props.questions } : null),
    hasTest: props.hasTest,
    reading: props.waiting,
    stale: props.formState?.stale ?? false,
    checkedAt: props.formState?.checkedAt ?? null,
    lastError: props.formState?.lastError ?? null
  })
)
// Без анкеты и без вопросов шаг сводится к одной строке.
const quiet = computed(() => !props.hasForm && props.hasTest === false)
</script>

<template>
  <ApplyStep :n="n" title="Анкета работодателя" id="apply-form">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
      <LoaderCircle v-if="waiting" class="size-4 animate-spin text-muted-foreground" />
      <span :class="cn(toneClasses(status.tone).text)">{{ status.text }}</span>
      <Button
        v-if="status.action !== null && !quiet"
        variant="ghost"
        size="sm"
        :disabled="busy || disabledRefresh"
        @click="emit('refresh')"
      >
        <RefreshCw class="size-4" :class="refreshing ? 'animate-spin' : ''" />
        {{ status.action === "read" ? "Прочитать анкету" : "Обновить" }}
      </Button>
    </div>
    <p v-if="formState && formState.versions > 1" class="text-xs text-muted-foreground">
      Вопросы на hh менялись, последний раз {{ formatDate(formState.changedAt) }}.
    </p>
    <Alert v-if="formState?.lastError" variant="destructive">
      <CircleAlert />
      <AlertTitle>Анкету не удалось обновить</AlertTitle>
      <AlertDescription>{{ formState.lastError }}</AlertDescription>
    </Alert>
    <p v-if="kitIsOld" class="text-sm text-warning">
      Вопросы на hh изменились после сохранения черновика. Проверьте ответы перед отправкой.
    </p>
    <AnswersEditor
      v-if="hasForm"
      :questions="questions"
      :answers="answers"
      :hints="hints"
      :problems="problems"
      :disabled="busy"
      @change="(id, value) => emit('change', id, value)"
    />
  </ApplyStep>
</template>
