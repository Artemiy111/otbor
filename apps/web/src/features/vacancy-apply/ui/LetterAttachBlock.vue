<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { watchDebounced } from "@vueuse/core"
import { CircleAlert, LoaderCircle, Send } from "@lucide/vue"
import type { ApplicationRecord } from "@otbor/contract"
import type { GeneratedDraft } from "@otbor/domain"
import { applicationApi, applicationKeys } from "@/entities/application"
import { useLetterStatus } from "../model"
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
 * The letter is kept per response (account + vacancy + resume), whoever made
 * the response: every resume has its own response and its own chat on hh.
 */
const draftQuery = useQuery({
  key: () => applicationKeys.letterDraft(props.vacancyId, props.accountId, props.resumeId),
  query: () =>
    applicationApi.letterDraftGet({
      vacancyId: props.vacancyId,
      hhAccountId: props.accountId,
      resumeId: props.resumeId || null
    }),
  enabled: () => props.accountId !== ""
})

const letter = ref("")
const touched = ref(false)
const loadedKey = ref<string | null>(null)
const keyNow = () => `${props.accountId}|${props.resumeId}`

watch(
  [() => draftQuery.data.value, keyNow],
  ([draft, key]) => {
    if (draft === undefined || draft === null) return
    if (loadedKey.value === key) return
    loadedKey.value = key
    letter.value = draft.letter ?? ""
    touched.value = false
  },
  { immediate: true }
)
// Switching to another resume shows that resume's letter, never the old text.
watch(keyNow, () => {
  loadedKey.value = null
  letter.value = ""
  touched.value = false
})

const saving = ref(false)
const savedAt = ref<string | null>(null)
const persist = async () => {
  if (!touched.value || loadedKey.value !== keyNow() || props.accountId === "") return
  saving.value = true
  try {
    await applicationApi.letterDraftSave({
      vacancyId: props.vacancyId,
      hhAccountId: props.accountId,
      resumeId: props.resumeId || null,
      letter: letter.value
    })
    savedAt.value = new Date().toISOString()
  } catch (error) {
    errorText.value = describeError(error)
  } finally {
    saving.value = false
  }
}
watchDebounced(letter, () => void persist(), { debounce: 800 })

/** hh keeps a separate response and chat per resume; the letter job does not name one yet. */
const respondedResumes = computed(
  () =>
    new Set(
      props.applications
        .filter(
          (application) =>
            application.hhAccountId === props.accountId &&
            ["submitted", "submitting", "queued"].includes(application.state)
        )
        .map((application) => application.resumeId ?? "")
    )
)
const ambiguous = computed(() => respondedResumes.value.size > 1)

const generated = (draft: GeneratedDraft) => {
  if (draft.letter !== null) {
    letter.value = draft.letter.slice(0, MAX_LETTER)
    touched.value = true
  }
}

const { query: statusQuery, status } = useLetterStatus(
  () => props.vacancyId,
  () => props.accountId
)
const active = computed(() => status.value?.status === "pending" || status.value?.status === "running")

const busy = ref(false)
const errorText = ref<string | null>(null)

const send = async () => {
  if (ambiguous.value || busy.value || active.value || letter.value.trim() === "" || props.accountId === "") return
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
  <div v-if="status?.status !== 'sent'" class="space-y-2">
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
      <span class="text-xs text-muted-foreground">
        {{ letter.length }} / {{ MAX_LETTER }}
        <template v-if="saving"> · сохраняю</template>
        <template v-else-if="savedAt || draftQuery.data.value?.updatedAt"> · черновик сохранён</template>
      </span>
      <Button
        size="sm"
        :disabled="ambiguous || busy || active || accountId === '' || letter.trim() === '' || status?.status === 'needs_human'"
        @click="send"
      >
        <LoaderCircle v-if="busy || active" class="size-4 animate-spin" />
        <Send v-else class="size-4" />
        Добавить на hh
      </Button>
    </div>
    <p v-if="ambiguous" class="flex items-start gap-1.5 text-xs text-destructive">
      <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
      На эту вакансию с аккаунта откликов несколько (по разным резюме), у каждого свой чат на hh. Отправка письма пока не умеет выбирать нужный, поэтому она отключена. Черновик сохраняется.
    </p>
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
