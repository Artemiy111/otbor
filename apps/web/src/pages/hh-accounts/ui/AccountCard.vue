<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import type { HhAccountRecord, OverviewAccount } from "@otbor/contract"
import { Check, Pencil, X } from "@lucide/vue"
import { autoModeOptions } from "@/entities/apply-filter"
import { autoModeTone } from "@/entities/auto-apply"
import {
  CommandChip,
  hhAccountColor,
  hhAccountInitials,
  hhAccountName
} from "@/entities/hh-account"
import { formatDate, formatNumber, toneClasses } from "@/shared/lib"
import { Badge, Button, Card, CardContent, Input, Skeleton } from "@/shared/ui"
import { describeLogin, describeUsage, minutesUntil } from "../model/account-state"

const props = defineProps<{
  account: HhAccountRecord
  /** Срез обзора по этому аккаунту; `undefined`, пока грузится или недоступен. */
  snapshot: OverviewAccount | undefined
  snapshotLoading: boolean
  resumesTotal: number
  resumesActive: number
  retrying: boolean
  resuming: boolean
  now: number
}>()

const emit = defineEmits<{
  saveLabel: [label: string]
  saveColor: [color: string | null]
  makeDefault: []
  retryStopped: []
  resumeNow: []
}>()

const name = computed(() => hhAccountName(props.account))
const color = computed(() => hhAccountColor(props.account))
const login = computed(() => describeLogin(props.account, formatDate))
const loginTone = computed(() => toneClasses(login.value.tone))

const usage = computed(() => (props.snapshot ? describeUsage(props.snapshot.usage) : null))
const usageTone = computed(() => (usage.value ? toneClasses(usage.value.tone) : null))

/** Пауза после капчи берётся из аккаунта: это самые свежие данные списка. */
const pausedSince = computed(() => props.account.submitBlockedAt ?? null)
const retryMinutes = computed(() => minutesUntil(props.snapshot?.submitRetryAt ?? null, props.now))
const retryText = computed(() => {
  const at = props.snapshot?.submitRetryAt ?? null
  if (at === null) return "Повтор произойдёт в ближайшую минуту."
  return retryMinutes.value === null
    ? "Повтор вот-вот."
    : `Повтор через ${retryMinutes.value} мин (${formatDate(at)}).`
})

const modes = computed(() =>
  (props.snapshot?.autoModes ?? []).map((row) => ({
    key: row.resumeId ?? "account",
    title: row.resumeTitle ?? "Все резюме аккаунта",
    label: autoModeOptions.find((option) => option.value === row.autoMode)?.label ?? row.autoMode,
    tone: autoModeTone(row.autoMode)
  }))
)
const autoLink = computed(() => `/auto-apply?account=${props.account.id}`)
const resumesLink = computed(() => `/resumes?account=${props.account.id}`)

const contacts = computed(() => {
  const value = props.account.contacts
  return [value?.phone, value?.email, value?.telegram].filter((item): item is string => !!item)
})
const details = computed<ReadonlyArray<readonly [string, string]>>(() => [
  ["Регион", props.account.areaName ?? "не указан"],
  ["Контакты", contacts.value.length > 0 ? contacts.value.join(" · ") : "не указаны"],
  ["Профиль сессии", props.account.sessionProfile ?? "нет"],
  ["Добавлен", formatDate(props.account.createdAt)]
])

/* Правка метки на месте */
const editing = ref(false)
const draft = ref("")
const labelInput = ref<InstanceType<typeof Input> | null>(null)
const startEdit = async () => {
  draft.value = props.account.label
  editing.value = true
  await nextTick()
  ;(labelInput.value?.$el as HTMLInputElement | undefined)?.focus()
}
const commitEdit = () => {
  const next = draft.value.trim()
  editing.value = false
  if (next !== "" && next !== props.account.label) emit("saveLabel", next)
}
</script>

<template>
  <Card class="overflow-hidden">
    <CardContent class="p-0">
      <!-- Кто это -->
      <div class="flex flex-wrap items-start gap-x-4 gap-y-3 p-5">
        <span
          class="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          :style="{ backgroundColor: color }"
          aria-hidden="true"
          >{{ hhAccountInitials(name) }}</span
        >
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-lg font-semibold leading-tight">{{ name }}</h2>
            <Badge v-if="account.isDefault" variant="info">Основной</Badge>
          </div>
          <div v-if="!editing" class="flex items-center gap-1 text-sm text-muted-foreground">
            <span>Метка: <span class="text-foreground">{{ account.label }}</span></span>
            <Button variant="ghost" size="icon" class="size-6" aria-label="Изменить метку" @click="startEdit">
              <Pencil class="size-3.5" />
            </Button>
          </div>
          <form v-else class="flex items-center gap-1" @submit.prevent="commitEdit">
            <Input
              ref="labelInput"
              v-model="draft"
              class="h-8 max-w-56"
              aria-label="Метка аккаунта"
              @keydown.escape.prevent="editing = false"
            />
            <Button type="submit" variant="ghost" size="icon" class="size-8" aria-label="Сохранить метку"><Check /></Button>
            <Button type="button" variant="ghost" size="icon" class="size-8" aria-label="Отменить" @click="editing = false"><X /></Button>
          </form>
        </div>
        <div class="flex items-center gap-1.5">
          <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Цвет
            <input
              type="color"
              :value="color"
              class="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
              :aria-label="`Цвет аккаунта ${name}`"
              @change="(event) => emit('saveColor', (event.target as HTMLInputElement).value)"
            />
          </label>
          <Button v-if="account.color" variant="ghost" size="sm" class="h-7 px-2" @click="emit('saveColor', null)">
            Сбросить
          </Button>
        </div>
      </div>

      <!-- Вход в hh.ru -->
      <section class="space-y-2 border-t p-5" :aria-label="`Вход в hh.ru, ${name}`">
        <h3 class="text-xs font-medium text-muted-foreground">Вход в hh.ru</h3>
        <div class="space-y-2 rounded-md border p-3" :class="[loginTone.border]">
          <div class="flex items-center gap-2 text-sm font-medium" :class="loginTone.text">
            <span class="size-2 shrink-0 rounded-full" :class="loginTone.dot" aria-hidden="true" />
            {{ login.label }}
          </div>
          <p class="text-sm text-muted-foreground">{{ login.detail }}</p>
          <p v-if="login.advice" class="text-sm">{{ login.advice }}</p>
          <CommandChip v-if="login.command" :command="login.command" />
        </div>
      </section>

      <!-- Отправка -->
      <section class="space-y-3 border-t p-5" :aria-label="`Отправка откликов, ${name}`">
        <h3 class="text-xs font-medium text-muted-foreground">Отправка откликов</h3>

        <div v-if="pausedSince" class="space-y-2 rounded-md border p-3" :class="toneClasses('warning').border">
          <div class="flex items-center gap-2 text-sm font-medium" :class="toneClasses('warning').text">
            <span class="size-2 shrink-0 rounded-full" :class="toneClasses('warning').dot" aria-hidden="true" />
            Пауза после капчи
          </div>
          <p class="text-sm text-muted-foreground">
            hh.ru показал проверку «я не робот» {{ formatDate(pausedSince) }}. Отправки остановлены, чтение вакансий идёт как обычно.
            {{ retryText }}
          </p>
          <Button variant="outline" size="sm" :disabled="resuming" @click="emit('resumeNow')">
            {{ resuming ? "Снимаю паузу…" : "Повторить сейчас" }}
          </Button>
        </div>

        <div v-if="snapshotLoading && !snapshot" class="space-y-2"><Skeleton class="h-4 w-48" /><Skeleton class="h-2 w-full" /></div>
        <template v-else-if="usage && usageTone && snapshot">
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span class="tabular-nums">
              <span class="text-base font-semibold">{{ formatNumber(usage.used) }}</span>
              из {{ formatNumber(usage.limit) }} откликов за сутки
            </span>
            <span class="text-xs tabular-nums" :class="usageTone.text">
              {{ usage.exhausted ? "лимит исчерпан" : `осталось ${formatNumber(snapshot.usage.remaining)}` }}
            </span>
          </div>
          <div
            class="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-valuenow="usage.used"
            aria-valuemin="0"
            :aria-valuemax="usage.limit"
            :aria-label="`Расход дневного лимита, ${name}`"
          >
            <div class="h-full rounded-full" :class="usageTone.dot" :style="{ width: `${usage.percent}%` }" />
          </div>
          <p class="text-xs tabular-nums text-muted-foreground">
            Последний отклик: {{ snapshot.lastSentAt ? formatDate(snapshot.lastSentAt) : "ещё не было" }}
            <template v-if="snapshot.active > 0"> · в работе: {{ snapshot.active }}</template>
            <template v-if="snapshot.needsAttention > 0"> · ждут вас: {{ snapshot.needsAttention }}</template>
            <template v-if="snapshot.captchas24h > 0"> · капч за сутки: {{ snapshot.captchas24h }}</template>
          </p>
        </template>
        <p v-else class="text-sm text-muted-foreground">Расход за сутки сейчас недоступен.</p>

        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" :disabled="retrying" @click="emit('retryStopped')">
            {{ retrying ? "Повторяю…" : "Повторить после капчи" }}
          </Button>
          <span class="text-xs text-muted-foreground">Заново запускает отклики, остановленные капчей или сбоем чтения анкеты.</span>
        </div>
      </section>

      <!-- Автоотклики и резюме -->
      <section class="space-y-3 border-t p-5" :aria-label="`Автоотклики и резюме, ${name}`">
        <h3 class="text-xs font-medium text-muted-foreground">Автоотклики по резюме</h3>
        <div v-if="snapshotLoading && !snapshot"><Skeleton class="h-5 w-56" /></div>
        <p v-else-if="modes.length === 0" class="text-sm text-muted-foreground">Автоотклики выключены.</p>
        <ul v-else class="space-y-1.5">
          <li v-for="mode in modes" :key="mode.key" class="flex items-center justify-between gap-3 text-sm">
            <span class="min-w-0 truncate">{{ mode.title }}</span>
            <Badge :variant="mode.tone">{{ mode.label }}</Badge>
          </li>
        </ul>
        <div class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a :href="autoLink" class="text-primary underline-offset-4 hover:underline">Настроить автоотклики</a>
          <a :href="resumesLink" class="text-primary underline-offset-4 hover:underline">
            {{ resumesTotal > 0 ? `Резюме: ${resumesTotal}` : "Резюме не загружены" }}
            <span v-if="resumesTotal > 0 && resumesActive !== resumesTotal" class="text-muted-foreground">
              (активных: {{ resumesActive }})
            </span>
          </a>
        </div>
      </section>

      <!-- Остальное -->
      <section class="space-y-2 border-t bg-muted/30 p-5" :aria-label="`Подробности, ${name}`">
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-for="[term, value] in details" :key="term">
            <dt class="text-muted-foreground">{{ term }}</dt>
            <dd class="min-w-0 break-words">{{ value }}</dd>
          </template>
        </dl>
        <div v-if="!account.isDefault" class="pt-1">
          <Button variant="outline" size="sm" @click="emit('makeDefault')">Сделать основным</Button>
        </div>
      </section>
    </CardContent>
  </Card>
</template>
