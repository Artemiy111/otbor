<script setup lang="ts">
import { computed } from "vue"
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountColorById } from "../colors"
import { hhAccountInitials, hhAccountName } from "../model"

const props = withDefaults(
  defineProps<{
    accountId: string | null | undefined
    accounts: ReadonlyArray<HhAccountRecord>
    /** Also print the name next to the circle (settings); tables show only the circle. */
    showName?: boolean
  }>(),
  { showName: false }
)

const account = computed(() => props.accounts.find((item) => item.id === props.accountId))
const name = computed(() =>
  account.value ? hhAccountName(account.value) : (props.accountId ?? "").slice(0, 8)
)
const color = computed(() => hhAccountColorById(props.accounts, props.accountId ?? ""))
</script>

<template>
  <span v-if="props.accountId" class="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
    <span
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      :style="{ backgroundColor: color }"
      :title="name"
      :aria-label="name"
    >
      {{ hhAccountInitials(name) }}
    </span>
    <span v-if="props.showName">{{ name }}</span>
  </span>
  <span v-else class="text-muted-foreground">—</span>
</template>
