<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import { applyFilterApi, applyFilterKeys, autoModeOptions } from "@/entities/apply-filter"
import { autoModeTone } from "@/entities/auto-apply"
import { hhAccountColor, hhAccountInitials, hhAccountName } from "@/entities/hh-account"
import { cn } from "@/shared/lib"
import { Badge } from "@/shared/ui"

/** Один аккаунт: кружок, имя и режим автооткликов общей строки аккаунта. */
const props = defineProps<{ account: HhAccountRecord; selected: boolean; disabled?: boolean }>()
defineEmits<{ select: [] }>()

const query = useQuery({
  key: () => applyFilterKeys.get(props.account.id, null),
  query: () => applyFilterApi.get({ hhAccountId: props.account.id })
})
const mode = computed(() => query.data.value?.autoMode ?? null)
const modeLabel = computed(() => autoModeOptions.find((option) => option.value === mode.value)?.label ?? "…")
const name = computed(() => hhAccountName(props.account))
</script>

<template>
  <button
    type="button"
    :aria-pressed="selected"
    :disabled="disabled"
    :title="`${name}: режим автооткликов для всех резюме аккаунта`"
    :class="
      cn(
        'inline-flex h-9 max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-2.5 pl-1 text-sm transition-colors',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border'
      )
    "
    @click="$emit('select')"
  >
    <span
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      :style="{ backgroundColor: hhAccountColor(account) }"
      aria-hidden="true"
      >{{ hhAccountInitials(name) }}</span
    >
    <span class="min-w-0 truncate font-medium">{{ name }}</span>
    <Badge :variant="mode === null ? 'neutral' : autoModeTone(mode)">{{ modeLabel }}</Badge>
  </button>
</template>
