<script setup lang="ts">
import { computed } from "vue"
import type { Overview } from "@otbor/contract"
import { defaultHhAccountColor, describeSubmitPause, hhAccountInitials } from "@/entities/hh-account"
import { cn, formatNumber, toneClasses } from "@/shared/lib"
import { Skeleton } from "@/shared/ui"
import { modeChips, sessionText } from "../model/accounts"
import { agoText, inText } from "../model/time"
import OverviewSection from "./OverviewSection.vue"

type Account = Overview["accounts"][number]

const props = defineProps<{
  accounts: ReadonlyArray<Account> | undefined
  loading: boolean
  now: number
}>()

const colorOf = (account: Account): string => account.color ?? defaultHhAccountColor(account.id)
const percent = (account: Account): number =>
  account.usage.limit > 0 ? Math.min(100, Math.round((account.usage.used / account.usage.limit) * 100)) : 0

const paused = (account: Account): boolean =>
  account.submitBlockedAt !== null &&
  (account.submitRetryAt === null || Date.parse(account.submitRetryAt) > props.now - 60_000)

/** Пауза словами; старый сервер причины не присылает, тогда это капча. */
const pauseOf = (account: Account) =>
  describeSubmitPause({ reason: account.submitBlockReason, detail: account.submitBlockDetail })

/** Цвет полосы: нейтральный, пока лимит не выбран; тон — только для исчерпанного. */
const barClass = (account: Account): string =>
  account.usage.remaining === 0 && account.usage.limit > 0 ? "bg-info" : "bg-primary"

const list = computed(() => props.accounts ?? [])
</script>

<template>
  <OverviewSection title="Аккаунты hh" description="Дневной лимит откликов и состояние входа.">
    <div v-if="props.loading" class="space-y-3" aria-busy="true">
      <div v-for="index in 2" :key="index" class="space-y-3 rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Skeleton class="size-9 rounded-full" />
          <Skeleton class="h-4 w-40" />
        </div>
        <Skeleton class="h-2 w-full" />
        <Skeleton class="h-3 w-2/3" />
      </div>
    </div>

    <p v-else-if="props.accounts === undefined" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      Данные об аккаунтах недоступны.
    </p>

    <p v-else-if="list.length === 0" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      Аккаунтов hh пока нет.
      <a href="/accounts" class="font-medium text-primary underline-offset-4 hover:underline">Добавить аккаунт</a>
    </p>

    <ul v-else class="space-y-3">
      <li v-for="account in list" :key="account.id" class="rounded-lg border bg-background/40 p-4">
        <div class="flex items-start gap-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{ backgroundColor: colorOf(account) }"
            aria-hidden="true"
          >{{ hhAccountInitials(account.name) }}</span>
          <div class="min-w-0 flex-1">
            <a href="/accounts" class="block truncate rounded text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {{ account.name }}
            </a>
            <p :class="cn('mt-0.5 flex items-center gap-1.5 text-xs', toneClasses(sessionText(account.session).tone).text)">
              <span :class="cn('size-1.5 rounded-full', toneClasses(sessionText(account.session).tone).dot)" aria-hidden="true" />
              {{ sessionText(account.session).text }}
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="chip in modeChips(account)"
            :key="chip.id"
            :class="cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', toneClasses(chip.tone).badge)"
          >{{ chip.label }}</span>
        </div>

        <div class="mt-4">
          <div class="flex items-baseline justify-between gap-2 text-xs">
            <span class="text-muted-foreground">За последние сутки</span>
            <span class="tabular-nums">
              <b class="text-sm font-semibold">{{ formatNumber(account.usage.used) }}</b>
              <span class="text-muted-foreground"> / {{ formatNumber(account.usage.limit) }}</span>
            </span>
          </div>
          <div
            class="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-valuenow="account.usage.used"
            aria-valuemin="0"
            :aria-valuemax="account.usage.limit"
            :aria-label="`Дневной лимит откликов, ${account.name}`"
          >
            <div :class="cn('h-full rounded-full transition-[width] motion-reduce:transition-none', barClass(account))" :style="{ width: `${percent(account)}%` }" />
          </div>
          <p class="mt-1.5 text-xs text-muted-foreground tabular-nums">
            <template v-if="account.usage.remaining > 0">Можно отправить ещё {{ formatNumber(account.usage.remaining) }}</template>
            <template v-else>Лимит исчерпан, освобождается постепенно</template>
          </p>
        </div>

        <p
          v-if="paused(account)"
          :class="cn('mt-3 rounded-md border px-3 py-2 text-xs', toneClasses('warning').badge)"
        >
          {{ pauseOf(account).kind === "captcha" ? pauseOf(account).summary : pauseOf(account).title }}<template v-if="inText(account.submitRetryAt, props.now)">, снова {{ inText(account.submitRetryAt, props.now) }}</template>.
          <span v-if="pauseOf(account).humanError" class="mt-1 block">{{ pauseOf(account).humanError }}</span>
        </p>

        <dl class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <div class="flex gap-1">
            <dt>В работе:</dt>
            <dd class="font-medium text-foreground">{{ formatNumber(account.active) }}</dd>
          </div>
          <div class="flex gap-1">
            <dt>Ждут вас:</dt>
            <dd :class="cn('font-medium', account.needsAttention > 0 ? 'text-warning' : 'text-foreground')">{{ formatNumber(account.needsAttention) }}</dd>
          </div>
          <div class="flex gap-1">
            <dt>Последний отклик:</dt>
            <dd class="font-medium text-foreground">{{ agoText(account.lastSentAt, props.now) ?? "ещё не было" }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </OverviewSection>
</template>
