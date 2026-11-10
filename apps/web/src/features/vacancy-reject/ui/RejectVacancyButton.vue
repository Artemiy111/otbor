<script setup lang="ts">
import { computed, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { Ban, ChevronDown, X } from "@lucide/vue"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { applicationKeys } from "@/entities/application"
import { blacklistApi, blacklistKeys, type RejectScope } from "@/entities/blacklist"
import { decisionKeys } from "@/entities/decision"
import { vacancyKeys } from "@/entities/vacancy"
import { describeError } from "@/shared/lib"
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui"

/**
 * Отбраковка вакансии: на неё не шлются автоотклики. Три слоя - для резюме,
 * для аккаунта hh и для всех моих резюме. Уже стоящие отбраковки показаны
 * рядом и снимаются крестиком.
 */
const props = defineProps<{
  vacancyId: string
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  /** Резюме и аккаунт, с которыми оператор работает на странице. */
  accountId: string
  resumeId: string
}>()

const open = ref(false)
const reason = ref("")
const errorText = ref<string | null>(null)
const queryCache = useQueryCache()

const rejectionsQuery = useQuery({
  key: () => blacklistKeys.rejections(props.vacancyId),
  query: () => blacklistApi.rejections(props.vacancyId)
})
const rejections = computed(() => rejectionsQuery.data.value ?? [])

const account = computed(() => props.accounts.find((item) => item.id === props.accountId) ?? null)
const resume = computed(() => props.resumes.find((item) => item.id === props.resumeId) ?? null)

const accountName = (id: string | null | undefined): string =>
  props.accounts.find((item) => item.id === id)?.label ?? "аккаунт"
const resumeName = (id: string | null | undefined): string =>
  props.resumes.find((item) => item.id === id)?.title ?? "резюме"

interface Option {
  readonly scope: RejectScope
  readonly title: string
  readonly hint: string
  readonly disabled: boolean
}

const options = computed<ReadonlyArray<Option>>(() => [
  {
    scope: "resume",
    title: resume.value === null ? "Для этого резюме" : `Для резюме «${resume.value.title}»`,
    hint: "Остальные резюме смогут откликнуться",
    disabled: resume.value === null
  },
  {
    scope: "hh_account",
    title: account.value === null ? "Для этого аккаунта" : `Для аккаунта «${account.value.label}»`,
    hint: "Все резюме этого аккаунта hh",
    disabled: account.value === null
  },
  {
    scope: "app",
    title: "Для всех моих резюме",
    hint: "Все резюме всех моих аккаунтов hh",
    disabled: false
  }
])

const refresh = async () => {
  await Promise.all([
    queryCache.invalidateQueries({ key: blacklistKeys.rejections(props.vacancyId) }),
    queryCache.invalidateQueries({ key: decisionKeys.all }),
    queryCache.invalidateQueries({ key: applicationKeys.all }),
    queryCache.invalidateQueries({ key: vacancyKeys.detail(props.vacancyId) })
  ])
}

const rejectMutation = useMutation({
  mutation: (scope: RejectScope) =>
    blacklistApi.rejectVacancy({
      vacancyId: props.vacancyId,
      scope,
      hhAccountId: scope === "hh_account" ? props.accountId : undefined,
      resumeId: scope === "resume" ? props.resumeId : undefined,
      reason: reason.value.trim() === "" ? undefined : reason.value.trim()
    }),
  onSuccess: async () => {
    open.value = false
    reason.value = ""
    errorText.value = null
    await refresh()
  },
  onError: (error) => {
    errorText.value = describeError(error)
  }
})

const unrejectMutation = useMutation({
  mutation: (id: string) => blacklistApi.unreject(id),
  onSuccess: refresh,
  onError: (error) => {
    errorText.value = describeError(error)
  }
})

const describeRejection = (record: (typeof rejections.value)[number]): string =>
  record.scope === "app"
    ? "Отбракована для всех моих резюме"
    : record.scope === "hh_account"
    ? `Отбракована для аккаунта «${accountName(record.hhAccountId)}»`
    : `Отбракована для резюме «${resumeName(record.resumeId)}»`
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span
      v-for="record in rejections"
      :key="record.id"
      class="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 py-0.5 pl-2 pr-1 text-xs text-destructive"
      :title="record.reason ?? undefined"
    >
      {{ describeRejection(record) }}
      <button
        type="button"
        class="rounded p-0.5 hover:bg-destructive/20"
        aria-label="Снять отбраковку"
        :disabled="unrejectMutation.isLoading.value"
        @click="unrejectMutation.mutate(record.id)"
      >
        <X class="size-3" />
      </button>
    </span>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm">
          <Ban class="size-4" />
          Отбраковать
          <ChevronDown class="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-80 p-2" align="end">
        <div class="space-y-0.5">
          <button
            v-for="option in options"
            :key="option.scope"
            type="button"
            class="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            :disabled="option.disabled || rejectMutation.isLoading.value"
            @click="rejectMutation.mutate(option.scope)"
          >
            <span class="text-sm">{{ option.title }}</span>
            <span class="text-xs text-muted-foreground">{{ option.hint }}</span>
          </button>
        </div>
        <Input v-model="reason" class="mt-2 h-8 text-xs" placeholder="Причина (необязательно)" />
        <p class="mt-2 px-1 text-xs text-muted-foreground">
          Автоотклики на неё не уйдут, неотправленные заявки будут пропущены.
        </p>
        <p v-if="errorText" class="mt-1 px-1 text-xs text-destructive">{{ errorText }}</p>
      </PopoverContent>
    </Popover>
  </div>
</template>
