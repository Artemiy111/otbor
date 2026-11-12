<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { Clock } from "@lucide/vue"
import { applicationKeys } from "@/entities/application"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { describeError } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"
import { hhAccountApi } from "../api"
import { hhAccountKeys, hhAccountName } from "../model"
import { describeSubmitPause, retryTimeText } from "../pause"

/**
 * Отправки аккаунта на паузе и возобновятся сами: hh показал капчу на отклике
 * или исполнитель браузера много раз подряд получил один и тот же отказ (пауза
 * растёт, если это повторяется). Вмешиваться не нужно; кнопка лишь повторяет
 * попытку раньше срока (`HhAccountSubmitResume`).
 */
const props = defineProps<{ accountId: string; accountName?: string }>()

const accounts = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const concurrency = useQuery({ key: () => queueJobKeys.concurrency(), query: () => queueJobApi.concurrency() })
const account = computed(() => accounts.data.value?.find((a) => a.id === props.accountId))
const name = computed(() => props.accountName ?? (account.value ? hhAccountName(account.value) : ""))
const retryAt = computed(
  () => concurrency.data.value?.accounts.find((a) => a.id === props.accountId)?.submitRetryAt ?? null
)
const retryText = computed(() =>
  retryAt.value === null ? "в ближайшую минуту" : `в ${retryTimeText(retryAt.value) ?? "ближайшую минуту"}`
)
const pause = computed(() => {
  const row = concurrency.data.value?.accounts.find((a) => a.id === props.accountId)
  return describeSubmitPause({
    reason: row?.submitBlockReason ?? account.value?.submitBlockReason,
    detail: row?.submitBlockDetail ?? account.value?.submitBlockDetail
  })
})

const queryCache = useQueryCache()
const busy = ref(false)
const error = ref<string | null>(null)

const retryNow = async () => {
  busy.value = true
  error.value = null
  try {
    await hhAccountApi.resumeSubmits(props.accountId)
    await Promise.all([
      queryCache.invalidateQueries({ key: hhAccountKeys.all }),
      queryCache.invalidateQueries({ key: queueJobKeys.all }),
      queryCache.invalidateQueries({ key: applicationKeys.all })
    ])
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Alert>
    <Clock />
    <AlertTitle>
      <template v-if="name">{{ name }}: </template>
      <template v-if="pause.kind === 'captcha'">пауза отправок после капчи, повтор {{ retryText }}</template>
      <template v-else>{{ pause.title }}. Попробуем снова {{ retryText }}</template>
    </AlertTitle>
    <AlertDescription class="space-y-2">
      <p v-if="pause.kind === 'repeated_failure' && pause.humanError">{{ pause.humanError }}</p>
      <details v-if="pause.rawDetail" class="text-xs text-muted-foreground">
        <summary class="cursor-pointer">Технические детали</summary>
        <p class="mt-1 break-words font-mono">{{ pause.rawDetail }}</p>
      </details>
      <p>Отклики возобновятся сами, чтение идёт как обычно. Делать ничего не нужно.</p>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <Button size="sm" variant="outline" :disabled="busy" @click="retryNow">Повторить сейчас</Button>
    </AlertDescription>
  </Alert>
</template>
