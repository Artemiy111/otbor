<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
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

const resume = async () => {
  busy.value = true
  error.value = null
  try {
    const result = await hhAccountApi.resumeSubmits(props.accountId)
    released.value = result.released
    await Promise.all([
      queryCache.invalidateQueries({ key: hhAccountKeys.all }),
      queryCache.invalidateQueries({ key: queueJobKeys.all })
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
      <Button size="sm" :disabled="busy" @click="resume">Продолжить</Button>
    </AlertDescription>
  </Alert>
</template>
