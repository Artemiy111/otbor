<script setup lang="ts">
import { computed, ref } from "vue"
import { RefreshCw, TriangleAlert } from "@lucide/vue"
import { useQueryCache } from "@pinia/colada"
import { hhAccountApi, defaultHhAccountColor } from "@/entities/hh-account"
import { overviewKeys } from "@/entities/overview"
import { cn, describeError } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { buildHeroNumbers } from "../model/hero"
import { agoText } from "../model/time"
import { useOverviewData } from "../model/useOverviewData"
import AccountsBlock from "./AccountsBlock.vue"
import AttentionList from "./AttentionList.vue"
import EventFeed from "./EventFeed.vue"
import FunnelBlock from "./FunnelBlock.vue"
import LiveNow from "./LiveNow.vue"
import SystemStrip from "./SystemStrip.vue"
import TimelineBlock from "./TimelineBlock.vue"
import VerdictHero from "./VerdictHero.vue"
import WindowSwitch from "./WindowSwitch.vue"

const data = useOverviewData()
const { overview, health, now, days } = data
const queryCache = useQueryCache()

const snapshot = computed(() => overview.data.value)
const heroNumbers = computed(() => (snapshot.value === undefined ? null : buildHeroNumbers(snapshot.value)))
const updated = computed(() => agoText(snapshot.value?.generatedAt, now.value))
const refreshing = computed(() => overview.asyncStatus.value === "loading" && snapshot.value !== undefined)

const accountColors = computed(
  () =>
    new Map((snapshot.value?.accounts ?? []).map((account) => [account.id as string, account.color ?? defaultHhAccountColor(account.id)]))
)

/** Повтор заявок, остановленных капчей: тот же вызов, что на странице аккаунтов. */
const retrying = ref<ReadonlySet<string>>(new Set())
const notice = ref<string | null>(null)
const actionError = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const retryCaptcha = async (accountId: string) => {
  actionError.value = null
  notice.value = null
  retrying.value = new Set([...retrying.value, accountId])
  try {
    const result = await hhAccountApi.retryCaptcha(accountId)
    const name = snapshot.value?.accounts.find((account) => account.id === accountId)?.name ?? "Аккаунт"
    notice.value = `${name}: повторено ${result.retried}, пропущено ${result.skipped.length}.`
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice.value = null), 8_000)
    await queryCache.invalidateQueries({ key: overviewKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    retrying.value = new Set([...retrying.value].filter((id) => id !== accountId))
  }
}
</script>

<template>
  <section>
    <PageHeader title="Обзор" description="Работает ли система, нужно ли вам вмешаться и что получается.">
      <template #actions>
        <p class="flex items-center gap-2 text-xs text-muted-foreground tabular-nums" role="status">
          <span v-if="updated">Обновлено {{ updated }}</span>
        </p>
        <Button variant="outline" size="icon" aria-label="Обновить данные" :disabled="refreshing" @click="data.refreshAll()">
          <RefreshCw :class="cn(refreshing && 'animate-spin motion-reduce:animate-none')" aria-hidden="true" />
        </Button>
        <WindowSwitch v-model="days" />
      </template>
    </PageHeader>

    <div class="space-y-6">
      <Alert v-if="data.overviewFailed.value" variant="destructive" class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-start gap-3">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <AlertTitle>Не удалось получить обзор</AlertTitle>
            <AlertDescription :title="describeError(overview.error.value)">
              Сервер не вернул снимок. <template v-if="snapshot">Показаны последние полученные данные.</template>
              <template v-else>Блоки ниже, которым хватает других источников, работают.</template>
            </AlertDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="overview.refetch()">Повторить</Button>
      </Alert>

      <Alert v-if="notice" role="status" variant="info">{{ notice }}</Alert>
      <Alert v-if="actionError" variant="destructive">{{ actionError }}</Alert>

      <VerdictHero :verdict="data.verdict.value" :numbers="heroNumbers" />

      <div class="grid gap-6 xl:grid-cols-12">
        <div class="xl:col-span-7 [&>section]:h-full">
          <AttentionList
            :items="data.items.value"
            :loading="data.firstLoad.value"
            :now="now"
            :checked-at="snapshot?.generatedAt ?? null"
            :retrying="retrying"
            @retry="retryCaptcha"
          />
        </div>
        <div class="grid items-start gap-6 md:grid-cols-2 xl:col-span-5 xl:grid-cols-1">
          <AccountsBlock :accounts="snapshot?.accounts" :loading="data.firstLoad.value" :now="now" />
          <LiveNow
            :jobs="snapshot?.jobs"
            :crawls="data.crawls.data.value"
            :schedule-runs="data.scheduleRuns.data.value"
            :schedules="data.schedules.data.value"
            :loading="data.firstLoad.value"
            :now="now"
          />
        </div>
      </div>

      <FunnelBlock
        :funnel="snapshot?.funnel"
        :skip-reasons="snapshot?.skipReasons"
        :days="days"
        :loading="data.firstLoad.value"
      />

      <div class="grid gap-6 xl:grid-cols-12">
        <div class="xl:col-span-7 [&>section]:h-full">
          <TimelineBlock :timeline="snapshot?.timeline" :days="days" :loading="data.firstLoad.value" />
        </div>
        <div class="xl:col-span-5">
          <EventFeed
            :events="snapshot?.events"
            :account-colors="accountColors"
            :loading="data.firstLoad.value"
            :now="now"
          />
        </div>
      </div>

      <SystemStrip :health="health.data.value" :health-failed="data.healthFailed.value" :proxy="data.proxy.data.value" />
    </div>
  </section>
</template>
