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

/**
 * hh показал капчу на отклике: отправки аккаунта на паузе и возобновятся сами
 * (пауза растёт, если капчи идут подряд). Вмешиваться не нужно; кнопка лишь
 * повторяет попытку раньше срока (`HhAccountSubmitResume`).
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
  retryAt.value === null
    ? "в ближайшую минуту"
    : `в ${new Date(retryAt.value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
)

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
      <template v-if="name">{{ name }}: </template>пауза отправок после капчи, повтор {{ retryText }}
    </AlertTitle>
    <AlertDescription class="space-y-2">
      <p>Отклики возобновятся сами, чтение идёт как обычно. Делать ничего не нужно.</p>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <Button size="sm" variant="outline" :disabled="busy" @click="retryNow">Повторить сейчас</Button>
    </AlertDescription>
  </Alert>
</template>
