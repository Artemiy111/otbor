<script setup lang="ts">
import { computed } from "vue"
import { ArrowUpRight, Check, Minus, RefreshCw, Sparkles, X } from "@lucide/vue"
import { AccountChip, hhAccountColorById, hhAccountInitials, hhAccountName } from "@/entities/hh-account"
import { pathWithTarget } from "@/features/filter-target"
import { cn, decisionsPath, describeError, formatPriority, toneClasses } from "@/shared/lib"
import { Alert, AlertDescription, Badge, Button, Skeleton, useToast } from "@/shared/ui"
import { decidedBy, fitPercent, fitTone, fitWasComputed, reasonLines, verdictText, type FilterFailure } from "../lib"
import type { VacancyPage } from "../model"
import VacancyFilterFailure from "./VacancyFilterFailure.vue"

/**
 * Главная карточка страницы: подходит ли вакансия, на сколько и почему. Показывает
 * решение для выбранных аккаунта и резюме; если областей несколько, их можно
 * переключить (выбор общий с панелью отклика справа).
 */
const props = defineProps<{ page: VacancyPage }>()
const toast = useToast()

const decision = computed(() => props.page.decision.value)
const fit = computed(() => (decision.value ? fitPercent(decision.value.fit) : 0))
const computedFit = computed(() => (decision.value ? fitWasComputed(decision.value) : true))
const tone = computed(() => toneClasses(computedFit.value ? fitTone(fit.value) : "neutral"))
const verdictTone = computed(() => {
  const verdict = decision.value?.verdict
  return toneClasses(verdict === "apply" ? "success" : verdict === "draft" ? "info" : "danger")
})
const lines = computed(() => (decision.value ? reasonLines(decision.value.reasons) : []))
/** Строки причин; правило фильтра раскладывается на отдельные строки по числу не прошедших правил. */
const rows = computed(() =>
  lines.value
    // Причина уже названа в заголовке вердикта («Пропущена: …»): второй раз не повторяем.
    .filter((line) => decision.value === null || !verdictText(decision.value).endsWith(`: ${line.text}`))
    .flatMap((line) =>
    line.failures !== undefined && line.failures.length > 0
      ? line.failures.map((failure) => ({ mark: line.mark, text: line.text, failure }))
      : [{ mark: line.mark, text: line.text, failure: null as FilterFailure | null }]
  )
)
const hasFilterRows = computed(() => rows.value.some((row) => row.failure !== null))
/** Фильтр открывается для тех же аккаунта и резюме, по которым считалось решение. */
const filterHref = computed(() =>
  pathWithTarget("/apply-filter", {
    accountId: decision.value?.hhAccountId ?? props.page.accountId.value,
    resumeId: decision.value?.resumeId ?? null
  })
)
const by = computed(() => (decision.value ? decidedBy(decision.value) : "rules"))

interface Scope {
  readonly key: string
  readonly accountId: string
  readonly resumeId: string
  readonly accountName: string
  readonly resumeTitle: string
  readonly initials: string
  readonly color: string
}

const scopes = computed<ReadonlyArray<Scope>>(() => {
  const seen = new Map<string, Scope>()
  for (const item of props.page.decisions.value) {
    const accountId = item.hhAccountId ?? ""
    const resumeId = item.resumeId ?? ""
    const key = `${accountId}|${resumeId}`
    if (accountId === "" || seen.has(key)) continue
    const account = props.page.accounts.value.find((entry) => entry.id === accountId)
    const resume = props.page.resumes.value.find((entry) => entry.id === resumeId)
    const accountName = account ? hhAccountName(account) : "аккаунт"
    seen.set(key, {
      key,
      accountId,
      resumeId,
      accountName,
      resumeTitle: resume?.title ?? "резюме не выбрано",
      initials: hhAccountInitials(accountName),
      color: hhAccountColorById(props.page.accounts.value, accountId)
    })
  }
  return [...seen.values()]
})
/** Имя аккаунта в подписи нужно, только когда в сравнении участвуют разные аккаунты. */
const severalAccounts = computed(() => new Set(scopes.value.map((scope) => scope.accountId)).size > 1)
const currentKey = computed(() => {
  const item = decision.value
  return item === null ? "" : `${item.hhAccountId ?? ""}|${item.resumeId ?? ""}`
})
const choose = (scope: Scope) => {
  props.page.accountId.value = scope.accountId
  if (scope.resumeId !== "") props.page.resumeId.value = scope.resumeId
}

const recalc = async () => {
  try {
    await props.page.evaluate()
    toast.success("Оценка пересчитана")
  } catch (error) {
    toast.error("Не удалось пересчитать оценку", { description: describeError(error) })
  }
}
const resumeTitle = computed(() => props.page.selectedResume.value?.title ?? null)
const account = computed(() => props.page.accounts.value.find((item) => item.id === props.page.accountId.value))
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby="verdict-title">
    <h2 id="verdict-title" class="text-sm font-semibold text-muted-foreground">Подходит ли вам вакансия</h2>
    <!-- Выбор «аккаунт · резюме»: название резюме целиком, на узком экране лента прокручивается вбок. -->
    <div
      v-if="scopes.length > 1"
      class="-mx-4 mt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-4 pb-1 sm:-mx-5 sm:px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
      role="group"
      aria-label="Для какого резюме оценка"
    >
      <button
        v-for="scope in scopes"
        :key="scope.key"
        type="button"
        :aria-pressed="scope.key === currentKey"
        :title="`${scope.accountName} · ${scope.resumeTitle}`"
        class="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border py-1.5 pl-1.5 pr-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:max-w-full md:shrink"
        :class="scope.key === currentKey ? 'border-primary bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'"
        @click="choose(scope)"
      >
        <span
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          :style="{ backgroundColor: scope.color }"
          aria-hidden="true"
        >{{ scope.initials }}</span>
        <span class="min-w-0">
          <span v-if="severalAccounts" class="block text-xs leading-tight text-muted-foreground">{{ scope.accountName }}</span>
          <span class="block whitespace-nowrap leading-tight md:whitespace-normal">{{ scope.resumeTitle }}</span>
        </span>
      </button>
    </div>

    <!-- Высота держится, пока решение грузится: ничего не прыгает. -->
    <div v-if="page.decisionState.value === 'loading'" class="mt-4 space-y-3" aria-busy="true">
      <Skeleton class="h-10 w-40" />
      <Skeleton class="h-2 w-full" />
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="h-4 w-2/3" />
    </div>

    <Alert v-else-if="page.decisionState.value === 'error'" variant="destructive" class="mt-4">
      <AlertDescription class="flex flex-wrap items-center gap-2">
        Не удалось получить оценку.
        <Button variant="outline" size="sm" @click="page.retryDecisions">Повторить</Button>
      </AlertDescription>
    </Alert>

    <div v-else-if="!decision" class="mt-4 space-y-3 text-sm">
      <p class="font-medium">Оценка не найдена</p>
      <p class="text-muted-foreground">
        Решений по этой вакансии нет среди найденных по названию и работодателю: её могли ещё не оценивать.
        Оценка считается без обращения к hh.
      </p>
      <Button variant="outline" size="sm" :disabled="page.evaluating.value || page.accountId.value === ''" @click="recalc">
        <RefreshCw class="size-4" :class="page.evaluating.value ? 'animate-spin' : ''" />
        Оценить сейчас
      </Button>
    </div>

    <div v-else class="mt-4 grid gap-4 sm:gap-6" :class="computedFit ? 'sm:grid-cols-[11rem_minmax(0,1fr)]' : ''">
      <div v-if="computedFit" class="space-y-2" :title="`Соответствие резюме: ${fit} из 100`">
        <div class="flex items-baseline gap-1.5">
          <span :class="cn('text-5xl font-semibold leading-none tabular-nums', tone.text)">{{ fit }}</span>
          <span class="text-sm text-muted-foreground">из 100</span>
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label="Соответствие резюме"
          :aria-valuenow="fit"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div :class="cn('h-full rounded-full', tone.dot)" :style="{ width: `${fit}%` }" />
        </div>
        <p class="text-xs tabular-nums text-muted-foreground" title="Соответствие с поправкой на свежесть вакансии">
          приоритет {{ formatPriority(decision.priority) }}
        </p>
      </div>

      <div class="min-w-0 space-y-3">
        <p :class="cn('text-lg font-semibold leading-snug', verdictTone.text)">{{ verdictText(decision) }}</p>
        <p v-if="!computedFit" class="text-sm text-muted-foreground">
          Соответствие резюме не считали: вакансия отсеяна раньше.
        </p>
        <ul class="space-y-1.5 text-sm">
          <li v-for="(row, index) in rows" :key="index" class="flex items-start gap-2">
            <Check v-if="row.mark === 'ok'" class="mt-0.5 size-4 shrink-0 text-success" aria-label="Плюс" />
            <X v-else-if="row.mark === 'no'" class="mt-0.5 size-4 shrink-0 text-danger" aria-label="Минус" />
            <Minus v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <VacancyFilterFailure v-if="row.failure" :failure="row.failure" />
            <span v-else class="min-w-0 break-words" :class="row.mark === 'note' ? 'text-muted-foreground' : ''">{{ row.text }}</span>
          </li>
        </ul>
        <a
          v-if="hasFilterRows"
          :href="filterHref"
          class="inline-flex items-center gap-1 rounded-sm text-sm text-info underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Открыть фильтр откликов
          <ArrowUpRight class="size-3.5" aria-hidden="true" />
        </a>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <Badge v-if="by === 'model'" variant="outline" class="gap-1 border-ai/30 bg-ai-muted text-ai">
            <Sparkles class="size-3" />
            оценила модель
          </Badge>
          <Badge v-else variant="neutral">оценили правила</Badge>
          <span class="flex min-w-0 items-center gap-1.5">
            для
            <AccountChip v-if="account" :account-id="account.id" :accounts="page.accounts.value" />
            <span class="truncate">{{ resumeTitle ?? "резюме не выбрано" }}</span>
          </span>
          <span class="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" :disabled="page.evaluating.value" @click="recalc">
              <RefreshCw class="size-4" :class="page.evaluating.value ? 'animate-spin' : ''" />
              Пересчитать
            </Button>
            <a :href="decisionsPath()" class="rounded-sm hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">Все решения</a>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
