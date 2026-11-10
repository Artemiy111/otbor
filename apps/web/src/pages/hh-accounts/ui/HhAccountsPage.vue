<script setup lang="ts">
import { computed, ref } from "vue"
import { useIntervalFn } from "@vueuse/core"
import { useQuery, useQueryCache } from "@pinia/colada"
import type { HhAccountRecord, OverviewAccount } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { hhAccountApi, hhAccountKeys, CaptchaEpisodesCard, CommandChip, hhAccountName } from "@/entities/hh-account"
import { overviewApi, overviewKeys, useOverviewWindow } from "@/entities/overview"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { RefreshButton } from "@/features/refresh-button"
import { describeError } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, EmptyState, Skeleton } from "@/shared/ui"
import { ConfirmSheet } from "@/shared/ui/confirm-sheet"
import { PageHeader } from "@/widgets/page-header"
import AccountCard from "./AccountCard.vue"

const query = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => query.data.value ?? [])

/** Тот же ключ, что у главной страницы: срез обзора лежит в кэше один на двоих. */
const days = useOverviewWindow()
const overview = useQuery({
  key: () => overviewKeys.get(days.value),
  query: () => overviewApi.get(days.value),
  staleTime: 10_000,
  placeholderData: (previous) => previous
})
const snapshots = computed(
  () => new Map<string, OverviewAccount>((overview.data.value?.accounts ?? []).map((item) => [item.id, item]))
)

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumeCounts = computed(() => {
  const counts = new Map<string, { total: number; active: number }>()
  for (const resume of resumesQuery.data.value ?? []) {
    const entry = counts.get(resume.hhAccountId) ?? { total: 0, active: 0 }
    entry.total += 1
    if (resume.isActive) entry.active += 1
    counts.set(resume.hhAccountId, entry)
  }
  return counts
})

/** Время для «повтор через N мин» обновляется раз в полминуты. */
const now = ref(Date.now())
useIntervalFn(() => (now.value = Date.now()), 30_000)

const queryCache = useQueryCache()
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)

const reload = () =>
  Promise.all([
    queryCache.invalidateQueries({ key: hhAccountKeys.all }),
    queryCache.invalidateQueries({ key: overviewKeys.all })
  ])

/**
 * The upsert payload that keeps every stored field. Optional fields left out
 * of the request reach the server as `null` and would wipe the session profile
 * and the name, so each one is sent explicitly.
 */
const keep = (account: HhAccountRecord) => ({
  id: account.id,
  label: account.label,
  isDefault: account.isDefault,
  sessionProfile: account.sessionProfile ?? undefined,
  firstName: account.firstName ?? undefined,
  lastName: account.lastName ?? undefined,
  areaName: account.areaName ?? undefined
})

const save = async (account: HhAccountRecord, patch: { label?: string; color?: string | null }) => {
  actionError.value = null
  try {
    await hhAccountApi.upsert({ ...keep(account), ...patch })
    await reload()
  } catch (error) {
    actionError.value = describeError(error)
  }
}

/* Основной аккаунт: единственное место, где он меняется. */
const defaultTarget = ref<HhAccountRecord | null>(null)
const defaultBusy = ref(false)
const confirmDefault = async () => {
  const account = defaultTarget.value
  if (account === null) return
  defaultBusy.value = true
  actionError.value = null
  try {
    await hhAccountApi.upsert({ ...keep(account), isDefault: true })
    defaultTarget.value = null
    await reload()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    defaultBusy.value = false
  }
}

/** Аккаунты, для которых сейчас идёт повтор заявок или снятие паузы. */
const retrying = ref<ReadonlySet<string>>(new Set())
const resuming = ref<ReadonlySet<string>>(new Set())
const toggle = (set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> =>
  on ? new Set([...set, id]) : new Set([...set].filter((item) => item !== id))

/** Повторяет заявки аккаунта, остановленные капчей или сбоем чтения формы. */
const retryStopped = async (account: HhAccountRecord) => {
  actionError.value = null
  notice.value = null
  retrying.value = toggle(retrying.value, account.id, true)
  try {
    const result = await hhAccountApi.retryCaptcha(account.id)
    notice.value = `${hhAccountName(account)}: повторено ${result.retried}, пропущено ${result.skipped.length}`
    await reload()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    retrying.value = toggle(retrying.value, account.id, false)
  }
}

/** Снимает паузу отправок раньше срока. */
const resumeNow = async (account: HhAccountRecord) => {
  actionError.value = null
  notice.value = null
  resuming.value = toggle(resuming.value, account.id, true)
  try {
    await hhAccountApi.resumeSubmits(account.id)
    await reload()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    resuming.value = toggle(resuming.value, account.id, false)
  }
}

const refresh = () => {
  void query.refetch()
  void overview.refetch()
  void resumesQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Аккаунты hh.ru"
      description="Состояние входа, лимит отправок и автоотклики по каждому аккаунту. Основной аккаунт меняется только здесь."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value || overview.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось выполнить действие</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" class="mb-4">
      <AlertTitle>Повтор заявок</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить аккаунты</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <div v-if="query.isPending.value" class="grid gap-4 xl:grid-cols-2">
      <Skeleton v-for="index in 2" :key="index" class="h-[34rem] rounded-xl" />
    </div>

    <EmptyState
      v-else-if="accounts.length === 0 && !query.error.value"
      title="Аккаунтов нет"
      description="Чтобы добавить аккаунт, выполните в терминале команду и войдите в hh.ru в открывшемся окне."
    >
      <CommandChip command="otbor hh login" />
    </EmptyState>

    <div v-else class="grid items-start gap-4 xl:grid-cols-2">
      <AccountCard
        v-for="account in accounts"
        :key="account.id"
        :account="account"
        :snapshot="snapshots.get(account.id)"
        :snapshot-loading="overview.isPending.value"
        :resumes-total="resumeCounts.get(account.id)?.total ?? 0"
        :resumes-active="resumeCounts.get(account.id)?.active ?? 0"
        :retrying="retrying.has(account.id)"
        :resuming="resuming.has(account.id)"
        :now="now"
        @save-label="(label) => save(account, { label })"
        @save-color="(color) => save(account, { color })"
        @make-default="defaultTarget = account"
        @retry-stopped="retryStopped(account)"
        @resume-now="resumeNow(account)"
      />
    </div>

    <CaptchaEpisodesCard class="mt-6" />

    <ConfirmSheet
      :open="defaultTarget !== null"
      :title="`Сделать «${defaultTarget ? hhAccountName(defaultTarget) : ''}» основным?`"
      description="Основной аккаунт используют команды otbor и ИИ-агент, когда аккаунт не указан. Фильтр «Показывать» в шапке от этого не меняется."
      confirm-label="Сделать основным"
      :busy="defaultBusy"
      @update:open="(value) => { if (!value) defaultTarget = null }"
      @confirm="confirmDefault"
    />
  </section>
</template>
