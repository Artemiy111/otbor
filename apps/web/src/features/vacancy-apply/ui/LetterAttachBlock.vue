<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { CircleAlert, CircleCheck, LoaderCircle, Send } from "@lucide/vue"
import type { ApplicationRecord } from "@otbor/contract"
import type { GeneratedDraft } from "@otbor/domain"
import { applicationApi, applicationKeys } from "@/entities/application"
import { describeError } from "@/shared/lib"
import DraftGenerator from "./DraftGenerator.vue"
import { Button, Textarea } from "@/shared/ui"

const props = defineProps<{
  vacancyId: string
  accountId: string
  resumeId: string
  applications: ReadonlyArray<ApplicationRecord>
}>()

const MAX_LETTER = 2000

/**
 * The letter written in otbor for this account. The draft became "submitted"
 * when hh showed the response, so any application otbor made itself counts,
 * the newest one first.
 */
const own = computed(
  () =>
    props.applications
      .filter((application) => application.hhAccountId === props.accountId && application.origin !== "imported")
      .toSorted((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0] ?? null
)
const draftQuery = useQuery({
  key: () => applicationKeys.detail(own.value?.id ?? "none"),
  query: () => applicationApi.get(own.value!.id),
  enabled: () => own.value !== null
})

const letter = ref("")
const touched = ref(false)
watch(
  () => draftQuery.data.value?.kit?.letter ?? "",
  (value) => {
    if (!touched.value && value.trim() !== "") letter.value = value
  },
  { immediate: true }
)

const generated = (draft: GeneratedDraft) => {
  if (draft.letter !== null) {
    letter.value = draft.letter.slice(0, MAX_LETTER)
    touched.value = true
  }
}

const statusQuery = useQuery({
  key: () => applicationKeys.letterAttach(props.vacancyId, props.accountId),
  query: () => applicationApi.letterAttachStatus({ vacancyId: props.vacancyId, hhAccountId: props.accountId }),
  enabled: () => props.accountId !== ""
})
const status = computed(() => statusQuery.data.value ?? null)
const active = computed(() => status.value?.status === "pending" || status.value?.status === "running")
useIntervalFn(() => void statusQuery.refetch(), 3000, { immediate: true, immediateCallback: false })

const busy = ref(false)
const errorText = ref<string | null>(null)

const send = async () => {
  if (busy.value || active.value || letter.value.trim() === "" || props.accountId === "") return
  busy.value = true
  errorText.value = null
  try {
    await applicationApi.letterAttach({
      vacancyId: props.vacancyId,
      hhAccountId: props.accountId,
      letter: letter.value.trim()
    })
    await statusQuery.refetch()
  } catch (error) {
    errorText.value = describeError(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="status?.status === 'sent'" class="flex items-center gap-2 text-sm">
    <CircleCheck class="size-4 text-emerald-600" />
    <span class="font-medium">Письмо отправлено</span>
    <span class="text-xs text-muted-foreground">проверьте чат на hh</span>
  </div>
  <div v-else class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Письмо к отправленному отклику
      </span>
      <DraftGenerator
        :vacancy-id="vacancyId"
        :account-id="accountId"
        :resume-id="resumeId"
        :questions="[]"
        :disabled="busy || active"
        @generated="generated"
        @failed="(reason) => (errorText = reason)"
      />
    </div>
    <Textarea
      v-model="letter"
      class="min-h-20 leading-relaxed"
      :maxlength="MAX_LETTER"
      :disabled="busy || active"
      placeholder="Текст письма, который hh добавит к отклику"
      @update:model-value="touched = true"
    />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground">{{ letter.length }} / {{ MAX_LETTER }}</span>
      <Button
        size="sm"
        :disabled="busy || active || accountId === '' || letter.trim() === '' || status?.status === 'needs_human'"
        @click="send"
      >
        <LoaderCircle v-if="busy || active" class="size-4 animate-spin" />
        <Send v-else class="size-4" />
        Добавить на hh
      </Button>
    </div>
    <p v-if="status?.status === 'needs_human'" class="flex items-start gap-1.5 text-xs text-destructive">
      <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
      Неясно, дошло ли письмо: {{ status.message }} Проверьте чат на hh, второй раз само не отправлю.
    </p>
    <p v-else-if="status?.status === 'failed'" class="flex items-start gap-1.5 text-xs text-destructive">
      <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
      Не отправлено: {{ status.message }}
    </p>
    <p v-if="errorText" class="text-xs text-destructive">{{ errorText }}</p>
  </div>
</template>
