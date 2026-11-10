<script setup lang="ts">
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountColor } from "../colors"
import { hhAccountName } from "../model"

/** Аккаунт в списке выбора: точка его цвета и имя. Годится и для значения закрытого select. */
defineProps<{ account: HhAccountRecord }>()
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: hhAccountColor(account) }" aria-hidden="true" />
    <span class="truncate">{{ hhAccountName(account) }}</span>
    <slot />
  </span>
</template>
