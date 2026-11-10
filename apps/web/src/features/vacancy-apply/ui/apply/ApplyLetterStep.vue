<script setup lang="ts">
import { Undo2 } from "@lucide/vue"
import type { GeneratedDraft } from "@otbor/domain"
import type { FormQuestion } from "@otbor/contract"
import { Button, Textarea } from "@/shared/ui"
import DraftGenerator from "../DraftGenerator.vue"
import ApplyStep from "./ApplyStep.vue"

/** Шаг «Письмо»: составить моделью, отредактировать, увидеть, что требует hh. */
const props = defineProps<{
  n: number
  vacancyId: string
  accountId: string
  resumeId: string
  questions: ReadonlyArray<FormQuestion>
  busy: boolean
  letterRule: "required" | "optional" | "absent" | "unknown"
  maxLetter: number
  generatedInfo: { model: string | null; durationMs: number | null; problems: ReadonlyArray<string> } | null
  canUndo: boolean
}>()
const letter = defineModel<string>({ required: true })
const emit = defineEmits<{
  generated: [
    draft: GeneratedDraft,
    meta: { model: string | null; durationMs: number | null; accountId: string; resumeId: string }
  ]
  failed: [reason: string]
  undo: []
}>()
</script>

<template>
  <ApplyStep :n="n" title="Письмо" id="apply-letter">
    <template #aside>
      <template v-if="letterRule === 'required'">hh требует письмо</template>
      <template v-else-if="letterRule === 'optional'">по желанию</template>
      <template v-else-if="letterRule === 'absent'">hh не принимает письмо</template>
      <template v-else>требование уточнится после чтения анкеты</template>
    </template>

    <div class="space-y-2 rounded-md border border-border p-3">
      <DraftGenerator
        :vacancy-id="props.vacancyId"
        :account-id="props.accountId"
        :resume-id="props.resumeId"
        :questions="props.questions"
        :disabled="props.busy"
        @generated="(draft, meta) => emit('generated', draft, meta)"
        @failed="(reason) => emit('failed', reason)"
      />
      <div v-if="generatedInfo" class="space-y-1 text-xs text-muted-foreground">
        <p>
          Составила: {{ generatedInfo.model ?? "модель не указана" }}<template
            v-if="generatedInfo.durationMs !== null"
          >, {{ (generatedInfo.durationMs / 1000).toFixed(1) }} с</template>. Результат уже сохранён как черновик.
        </p>
        <ul v-if="generatedInfo.problems.length > 0" class="list-disc space-y-0.5 pl-5 text-warning">
          <li v-for="problem in generatedInfo.problems" :key="problem">{{ problem }}</li>
        </ul>
      </div>
      <Button v-if="canUndo" variant="ghost" size="sm" @click="emit('undo')">
        <Undo2 class="size-4" />
        Отменить подстановку
      </Button>
    </div>

    <div class="space-y-1">
      <Textarea
        v-model="letter"
        class="min-h-40 leading-relaxed"
        aria-label="Сопроводительное письмо"
        :maxlength="maxLetter"
        :disabled="letterRule === 'absent' || busy"
        placeholder="Здравствуйте! Меня заинтересовала вакансия…"
      />
      <div class="text-right text-xs tabular-nums text-muted-foreground">{{ letter.length }} / {{ maxLetter }}</div>
    </div>
  </ApplyStep>
</template>
