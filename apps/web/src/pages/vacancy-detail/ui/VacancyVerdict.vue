<script setup lang="ts">
import { computed } from "vue"
import { Check, Minus, RefreshCw, Sparkles, X } from "@lucide/vue"
import { AccountChip, hhAccountName } from "@/entities/hh-account"
import { cn, decisionsPath, describeError, formatPriority, toneClasses } from "@/shared/lib"
import { Alert, AlertDescription, Badge, Button, Skeleton, useToast } from "@/shared/ui"
import { decidedBy, fitPercent, fitTone, fitWasComputed, reasonLines, verdictText } from "../lib"
import type { VacancyPage } from "../model"

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
const by = computed(() => (decision.value ? decidedBy(decision.value) : "rules"))

interface Scope {
  readonly key: string
  readonly accountId: string
  readonly resumeId: string
  readonly label: string
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
    seen.set(key, {
      key,
      accountId,
      resumeId,
      label: [account ? hhAccountName(account) : "аккаунт", resume?.title].filter(Boolean).join(" · ")
    })
  }
  return [...seen.values()]
})
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
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="verdict-title" class="text-sm font-semibold text-muted-foreground">Подходит ли вам вакансия</h2>
      <div v-if="scopes.length > 1" class="flex flex-wrap gap-1" role="group" aria-label="Для какого резюме оценка">
        <button
          v-for="scope in scopes"
          :key="scope.key"
          type="button"
          :aria-pressed="scope.key === currentKey"
          class="max-w-56 truncate rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          :class="scope.key === currentKey ? 'border-primary bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'"
          @click="choose(scope)"
        >{{ scope.label }}</button>
      </div>
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

    <div v-else class="mt-4 grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <div class="space-y-2" :title="`Соответствие резюме: ${fit} из 100`">
        <div class="flex items-baseline gap-1.5">
          <span :class="cn('text-5xl font-semibold leading-none tabular-nums', tone.text)">{{ computedFit ? fit : "—" }}</span>
          <span class="text-sm text-muted-foreground">{{ computedFit ? "из 100" : "не считалось" }}</span>
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-muted"
          :role="computedFit ? 'meter' : 'presentation'"
          :aria-label="computedFit ? 'Соответствие резюме' : undefined"
          :aria-valuenow="computedFit ? fit : undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div :class="cn('h-full rounded-full', tone.dot)" :style="{ width: computedFit ? `${fit}%` : '0%' }" />
        </div>
        <p v-if="computedFit" class="text-xs tabular-nums text-muted-foreground" title="Соответствие с поправкой на свежесть вакансии">
          приоритет {{ formatPriority(decision.priority) }}
        </p>
      </div>

      <div class="min-w-0 space-y-3">
        <p :class="cn('text-lg font-semibold leading-snug', verdictTone.text)">{{ verdictText(decision) }}</p>
        <ul class="space-y-1.5 text-sm">
          <li v-for="(line, index) in lines" :key="index" class="flex items-start gap-2">
            <Check v-if="line.mark === 'ok'" class="mt-0.5 size-4 shrink-0 text-success" aria-label="Плюс" />
            <X v-else-if="line.mark === 'no'" class="mt-0.5 size-4 shrink-0 text-danger" aria-label="Минус" />
            <Minus v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span :class="line.mark === 'note' ? 'text-muted-foreground' : ''">{{ line.text }}</span>
          </li>
        </ul>
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
