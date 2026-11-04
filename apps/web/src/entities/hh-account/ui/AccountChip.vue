<script setup lang="ts">
import { computed } from "vue"
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountHue, hhAccountInitials, hhAccountName } from "../model"

const props = defineProps<{
  accountId: string | null | undefined
  accounts: ReadonlyArray<HhAccountRecord>
}>()

const account = computed(() => props.accounts.find((item) => item.id === props.accountId))
const name = computed(() =>
  account.value ? hhAccountName(account.value) : (props.accountId ?? "").slice(0, 8)
)
const hue = computed(() => hhAccountHue(props.accountId ?? ""))
</script>

<template>
  <span v-if="props.accountId" class="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
    <span
      class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      :style="{ backgroundColor: `hsl(${hue} 55% 42%)` }"
      aria-hidden="true"
    >
      {{ hhAccountInitials(name) }}
    </span>
    <span>{{ name }}</span>
  </span>
  <span v-else class="text-muted-foreground">—</span>
</template>
