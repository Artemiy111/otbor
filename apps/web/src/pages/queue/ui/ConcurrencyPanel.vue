<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue"
import { useQuery } from "@pinia/colada"
import type { StageCount } from "@otbor/contract"
import { CaptchaBlockAlert, CaptchaStatus } from "@/entities/hh-account"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { describeError, formatAge, jobStageLabel } from "@/shared/lib"
import { Badge, Card, CardContent, HelpHint, Skeleton } from "@/shared/ui"

/** Параллельность: сколько задач исполнители ведут одновременно и что идёт на каждом аккаунте. */
const query = useQuery({
  key: () => queueJobKeys.concurrency(),
  query: () => queueJobApi.concurrency()
})

// Цифры живые: страница обновляет их сама, а не только по кнопке.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => void query.refetch(), 5000)
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})

const data = computed(() => query.data.value)
const errorText = computed(() => (query.error.value ? describeError(query.error.value) : null))

const waitingText = (pending: ReadonlyArray<StageCount>): string =>
  pending.length === 0
    ? "никого"
    : pending.map((c) => `${jobStageLabel(c.stage).toLowerCase()} ${c.count}`).join(", ")

/** Время суток для строки про темп. */
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })

const refetch = () => query.refetch()
defineExpose({ refetch, loading: computed(() => query.isLoading.value) })
</script>

<template>
  <Card>
    <CardContent class="space-y-3 p-4">
      <div class="flex items-center gap-2">
        <p class="text-sm font-semibold">Параллельность</p>
        <HelpHint
          text="Читающие задания (проверка откликов, чаты, обновление статусов) идут параллельно, но не больше лимита браузерных задач на аккаунт. Чтение формы отклика ограничено отдельно и идёт с паузой. Отправки и письма ограничены меньшим лимитом и идут с паузой между собой. Капча ставит отправки аккаунта на паузу, она снимается сама (при капчах подряд пауза растёт). Генерация от аккаунтов не зависит: её ограничивает только число потоков исполнителя. Все числа меняются в настройках."
        />
        <a href="/settings" class="ml-auto text-xs text-muted-foreground underline underline-offset-2">Изменить в настройках</a>
      </div>

      <p v-if="errorText" class="text-sm text-danger" role="alert">Не удалось прочитать данные о параллельности: {{ errorText }}</p>
      <div v-else-if="!data" class="space-y-2" aria-busy="true"><Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-2/3" /><Skeleton class="h-16 w-full" /></div>

      <template v-else>
        <p class="text-xs tabular-nums text-muted-foreground">
          Браузерных задач на аккаунт: до {{ data.browserCap }}, из них отправок до {{ data.actingCap }} · пауза между отправками
          {{ data.submitIntervalSeconds }} с + до {{ data.submitJitterPercent }}% · не больше
          {{ data.submitHourlyLimit ?? "без ограничения" }} в час · потоков исполнителя: {{ data.harnessSlots }}
        </p>
        <p class="text-xs tabular-nums text-muted-foreground">
          Одновременных чтений формы на аккаунт: {{ data.formReadConcurrency }} · пауза между чтениями
          {{ data.formReadIntervalSeconds }} с + до {{ data.formReadJitterPercent }}% · при капче реже в
          {{ data.formReadBlockedFactor }} раз
        </p>

        <div class="space-y-1 text-sm">
          <p v-for="h in data.harnesses" :key="h.id" class="tabular-nums">
            Исполнитель {{ h.name }} · потоки {{ h.busy }} из {{ h.slots ?? "?" }}
            <span v-if="h.slots === null" class="text-muted-foreground">(число потоков ещё не сообщено)</span>
          </p>
          <p v-if="data.harnesses.length === 0" class="text-muted-foreground">Исполнитель не зарегистрирован.</p>
          <p class="tabular-nums text-muted-foreground">
            Генерация: идёт {{ data.inference.running }}, ждут {{ data.inference.pending }}
          </p>
        </div>

        <ul class="space-y-2">
          <li v-for="a in data.accounts" :key="a.id" class="rounded-md border p-3 text-sm">
            <p class="tabular-nums">
              <span class="font-medium">{{ a.name }}</span>
              · браузер {{ a.browserRunning }} из {{ data.browserCap }}
              · отправки {{ a.actingRunning }} из {{ data.actingCap }}
              · ждут: {{ waitingText(a.pending) }}
              <span v-if="a.pendingTotal > 0" class="text-muted-foreground">
                (старейшее {{ formatAge(a.oldestPendingAgeSeconds) }})
              </span>
            </p>
            <CaptchaBlockAlert v-if="a.submitBlockedAt" class="mt-2" :account-id="a.id" :account-name="a.name" />
            <p class="mt-1 text-xs text-muted-foreground"><CaptchaStatus :account="a" /></p>
            <p v-if="a.nextSubmitAt" class="mt-1 text-xs text-muted-foreground">
              следующая отправка не раньше {{ clock(a.nextSubmitAt) }}
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge v-for="c in a.running" :key="c.stage" variant="secondary">
                {{ jobStageLabel(c.stage) }} × {{ c.count }}
              </Badge>
              <span v-if="a.running.length === 0" class="text-xs text-muted-foreground">ничего не идёт</span>
              <span class="ml-auto text-xs text-muted-foreground">
                {{ a.holderHarnessName ? `ведёт ${a.holderHarnessName}` : "никто не ведёт" }}
              </span>
            </div>
          </li>
        </ul>
      </template>
    </CardContent>
  </Card>
</template>
