<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { applicationKeys } from "@/entities/application"
import { queueJobKeys } from "@/entities/queue-job"
import { describeError } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"
import { hhAccountApi } from "../api"
import { hhAccountKeys, hhAccountName } from "../model"

/**
 * hh показал капчу на отклике, и отправки аккаунта остановлены без срока: она
 * не уйдёт сама, пока человек не решит её в профиле браузера. Кнопка снимает
 * блокировку (`HhAccountSubmitResume`).
 */
const props = defineProps<{ accountId: string; accountName?: string }>()

const accounts = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const account = computed(() => accounts.data.value?.find((a) => a.id === props.accountId))
const profile = computed(() => account.value?.sessionProfile ?? null)
const name = computed(() => props.accountName ?? (account.value ? hhAccountName(account.value) : ""))

const queryCache = useQueryCache()
const busy = ref(false)
const error = ref<string | null>(null)
const released = ref<number | null>(null)
const retried = ref<number | null>(null)

/**
 * `retry`: после снятия блокировки повторяет и заявки, остановленные капчей
 * (`needs_human`/`failed`), чтобы они прошли заново с распознаванием моделью.
 */
const resume = async (retry = false) => {
  busy.value = true
  error.value = null
  try {
    const result = await hhAccountApi.resumeSubmits(props.accountId)
    released.value = result.released
    if (retry) retried.value = (await hhAccountApi.retryCaptcha(props.accountId)).retried
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
  <Alert variant="destructive">
    <CircleAlert />
    <AlertTitle>
      <template v-if="name">{{ name }}: </template>hh просит капчу — отправки остановлены
    </AlertTitle>
    <AlertDescription class="space-y-2">
      <p>
        Решите капчу в профиле харнеса и нажмите «Продолжить». Профиль открывается командой
        <code class="font-mono text-xs">otbor hh login --profile {{ profile ?? "&lt;профиль&gt;" }}</code>
        (на машине, где работает харнес; остановите там задачу или дождитесь её конца). Чтение идёт как обычно, автоотклики ждут.
      </p>
      <p v-if="error" class="text-sm">{{ error }}</p>
      <p v-if="released !== null || retried !== null" class="text-sm">
        Возвращено раннеру: {{ released ?? 0 }}<template v-if="retried !== null">, повторено заявок: {{ retried }}</template>.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" :disabled="busy" @click="resume(false)">Продолжить</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="busy"
          title="Снять блокировку и заново пройти заявки, остановленные капчей: теперь капчу прочитает выбранная модель"
          @click="resume(true)"
        >
          Продолжить и повторить упавшие на капче
        </Button>
      </div>
    </AlertDescription>
  </Alert>
</template>
