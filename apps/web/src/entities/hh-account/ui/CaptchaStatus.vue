<script setup lang="ts">
import { computed } from "vue"
import type { QueueConcurrency } from "@otbor/contract"
import { formatAge } from "@/shared/lib"

/**
 * Как давно hh не показывал капчу: сколько откликов прошло после последней,
 * когда она была и сколько их было за сутки.
 */
const props = defineProps<{ account: Pick<QueueConcurrency["accounts"][number], "lastCaptchaAt" | "captchas24h" | "submitsSinceCaptcha"> }>()

const text = computed(() => {
  const { lastCaptchaAt, captchas24h, submitsSinceCaptcha } = props.account
  if (lastCaptchaAt === null) return `Капчи ещё не было · откликов без капчи: ${submitsSinceCaptcha}`
  const ago = formatAge((Date.now() - Date.parse(lastCaptchaAt)) / 1000)
  const clock = new Date(lastCaptchaAt).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  })
  return `Без капчи: ${submitsSinceCaptcha} откликов · последняя капча ${ago} назад (${clock}) · за 24 ч: ${captchas24h}`
})
</script>

<template>
  <span class="tabular-nums">{{ text }}</span>
</template>
