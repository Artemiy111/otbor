<script setup lang="ts">
import { computed } from "vue"
import type { FormQuestion, StoredHint } from "@otbor/contract"
import { cn, toneClasses } from "@/shared/lib"
import { Textarea } from "@/shared/ui"
import { emptyAnswer, isChoice, toggleOption, type AnswerState } from "../lib/answers"

/**
 * Ответы на форму работодателя: вопросы по порядку и подходящее поле для
 * каждого типа (один вариант, несколько, текст, код). Редактор ничего не
 * сохраняет: он показывает ответы, подсказки и отказы сервера у нужного
 * вопроса, а изменения отдаёт наружу. Один и тот же на странице вакансии и
 * на странице отклика.
 */
const props = withDefaults(
  defineProps<{
    questions: ReadonlyArray<FormQuestion>
    answers: Readonly<Record<string, AnswerState>>
    hints?: ReadonlyArray<StoredHint>
    /** Отказ сервера по вопросам: `questionId` -> фразы. */
    problems?: ReadonlyMap<string, ReadonlyArray<string>>
    disabled?: boolean
    /** Префикс id полей: на странице может быть два редактора. */
    idPrefix?: string
  }>(),
  { hints: () => [], problems: () => new Map(), disabled: false, idPrefix: "q" }
)

const emit = defineEmits<{ change: [questionId: string, answer: AnswerState] }>()

const answerOf = (id: string): AnswerState => props.answers[id] ?? emptyAnswer()
const hintFor = (id: string) => props.hints.find((hint) => hint.questionId === id)
const problemsOf = (id: string): ReadonlyArray<string> => props.problems.get(id) ?? []

const needsOwnAnswer = computed(() => props.questions.filter((question) => question.kind === "code").length)

const pick = (question: FormQuestion, optionId: string) =>
  emit("change", question.id, toggleOption(question, answerOf(question.id), optionId))
const type = (question: FormQuestion, value: string | number | undefined) =>
  emit("change", question.id, { ...answerOf(question.id), text: String(value ?? "") })
</script>

<template>
  <div v-if="questions.length > 0" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-x-3">
      <span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase tabular-nums">
        Вопросы работодателя ({{ questions.length }})
      </span>
      <span v-if="needsOwnAnswer > 0" :class="cn('text-xs', toneClasses('warning').text)">
        есть задание с кодом: ответьте сами
      </span>
    </div>
    <fieldset
      v-for="(question, index) in questions"
      :key="question.id"
      :disabled="disabled"
      :aria-invalid="problemsOf(question.id).length > 0 || undefined"
      :aria-describedby="problemsOf(question.id).length > 0 ? `${idPrefix}-${question.id}-problems` : undefined"
      :class="
        cn(
          'space-y-2 rounded-md border p-3',
          problemsOf(question.id).length > 0 ? cn(toneClasses('danger').border, toneClasses('danger').bg) : 'border-border'
        )
      "
    >
      <legend class="px-1 text-sm font-medium">
        {{ index + 1 }}. {{ question.text }}
        <span v-if="question.required" :class="toneClasses('danger').text" title="Обязательный вопрос">*</span>
      </legend>
      <p v-if="hintFor(question.id)?.note" class="text-xs text-muted-foreground">
        Подсказка: {{ hintFor(question.id)?.note }}
      </p>

      <template v-if="isChoice(question)">
        <label
          v-for="option in question.options"
          :key="option.id"
          class="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/40"
        >
          <input
            :type="question.kind === 'single' ? 'radio' : 'checkbox'"
            :name="`${idPrefix}-${question.id}`"
            class="mt-0.5 size-4 accent-primary"
            :checked="answerOf(question.id).optionIds.includes(option.id)"
            @change="pick(question, option.id)"
          />
          <span>{{ option.label }}</span>
        </label>
      </template>
      <Textarea
        v-else
        :model-value="answerOf(question.id).text"
        :class="question.kind === 'code' ? 'min-h-32 font-mono text-xs' : 'min-h-20'"
        :maxlength="question.maxLength ?? undefined"
        :aria-label="`Ответ на вопрос ${index + 1}`"
        :placeholder="question.kind === 'code' ? `Код${question.codeLanguage ? ` (${question.codeLanguage})` : ''}` : 'Ваш ответ'"
        @update:model-value="(value) => type(question, value)"
      />

      <ul
        v-if="problemsOf(question.id).length > 0"
        :id="`${idPrefix}-${question.id}-problems`"
        :class="cn('space-y-0.5 text-xs', toneClasses('danger').text)"
      >
        <li v-for="text in problemsOf(question.id)" :key="text">{{ text }}</li>
      </ul>
    </fieldset>
  </div>
</template>
